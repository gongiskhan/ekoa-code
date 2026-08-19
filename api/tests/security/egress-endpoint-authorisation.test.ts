import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings, bridgeCapabilityGrants } from '../../src/data/stores.js';
import { normaliseEgressEndpoint } from '../../src/bridge/egress-endpoint.js';
import { grantCapability } from '../../src/bridge/capability-grants.js';
import {
  registerPairing,
  getPairingById,
  egressCandidatesForOrg,
  advertisedCapabilitiesForOrg,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';
import { resolveEgress, proxyOptionFor } from '../../src/automation/egress-policy.js';

/**
 * SECURITY SUITE — a machine's SELF-ASSERTED egress address is not an authorisation (Cofre I-3,
 * the half that was missing).
 *
 * THE DEFECT. `hello.egressEndpoint` is a free string on the wire, and this branch gave
 * `proxyOptionFor` its first production caller: the resolution now becomes
 * `browser.newContext({ proxy })` for the org's HOSTED Chromium. Between the frame and the launch
 * option there was no validation and no authorisation of the ADDRESS at all - `registerPairing`
 * stored it verbatim, `egressCandidatesForOrg` intersected the CAPABILITIES with the org's grants
 * and passed the endpoint through untouched, and `resolveEgress` handed it back as `proxyUrl`.
 *
 * So a machine in org A that sent `{capabilities:['egress.residential'],
 * egressEndpoint:'http://attacker.example:8080'}` had only to be granted `egress.residential` -
 * a grant that authorises the MACHINE and carried no endpoint at all - for the org's hosted
 * browser to launch through the attacker's proxy, credential-gated steps included. A compromised
 * daemon could change the destination on any reconnect with no new grant.
 *
 * THE TWO HALVES OF THE FIX, and neither is sufficient alone:
 *   1. SHAPE (`bridge/egress-endpoint.ts`). Scheme allowlist, no embedded credentials, no path,
 *      and a refusal of loopback / link-local / RFC1918 / multicast - while ALLOWING the tailnet
 *      ranges, which a naive "reject private addresses" rule would throw away. This stops the
 *      metadata-service and loopback shapes. It cannot stop a public attacker host.
 *   2. AUTHORISATION (`bridge/capability-grants.ts`). The grant NAMES the endpoint it authorises,
 *      and `egressCandidatesForOrg` only carries an endpoint the org's live grant names. This is
 *      what stops the public host, and what makes a changed endpoint fail closed.
 */
let mem: MongoMemoryServer;
const ORG = 'orgA';
const TAILNET = 'http://100.64.0.7:1080';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_egress_endpoint');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await bridgePairings.deleteMany({});
  await bridgeCapabilityGrants.deleteMany({});
  __resetLiveConnectionsForTests();
});

/** The org's candidates as SELECTION sees them, with the socket presumed live. */
async function candidates(org = ORG) {
  return (await egressCandidatesForOrg(org)).map((c) => ({ ...c, live: true }));
}

/** The launch option a residential run would actually get. undefined = the datacenter route. */
async function proxyForResidentialRun(org = ORG) {
  const r = resolveEgress({ requirement: { kind: 'residential' }, offlinePolicy: 'fail' }, await candidates(org), org);
  return { resolution: r, proxy: proxyOptionFor(r) };
}

describe('the shape a proxy target may have', () => {
  it('accepts the tailnet forms this field exists for, in canonical form', () => {
    expect(normaliseEgressEndpoint('http://100.64.0.7:1080')).toBe('http://100.64.0.7:1080');
    // 100.64.0.0/10 is RFC 6598 SHARED ADDRESS SPACE - a naive "reject private ranges" rule would
    // throw away the exact range Tailscale hands out, i.e. every legitimate value of this field.
    expect(normaliseEgressEndpoint('http://100.127.255.254:1080')).toBe('http://100.127.255.254:1080');
    expect(normaliseEgressEndpoint('socks5://100.64.0.7:1080')).toBe('socks5://100.64.0.7:1080');
    expect(normaliseEgressEndpoint('http://[fd7a:115c:a1e0::1]:1080')).toBe('http://[fd7a:115c:a1e0::1]:1080');
    expect(normaliseEgressEndpoint('https://laptop.tail1234.ts.net:1080')).toBe('https://laptop.tail1234.ts.net:1080');
  });

  it('canonicalises, because the grant binding downstream is an EQUALITY test', () => {
    // Playwright's short form `host:port` IS an http proxy; two spellings of one address must not
    // be able to read as two different authorisations, in either direction.
    expect(normaliseEgressEndpoint('100.64.0.7:1080')).toBe('http://100.64.0.7:1080');
    expect(normaliseEgressEndpoint('HTTP://100.64.0.7:1080/')).toBe('http://100.64.0.7:1080');
    expect(normaliseEgressEndpoint('  http://100.64.0.7:1080  ')).toBe('http://100.64.0.7:1080');
  });

  it('refuses everything that is not a proxy target', () => {
    expect(normaliseEgressEndpoint(undefined)).toBeNull();
    expect(normaliseEgressEndpoint('')).toBeNull();
    expect(normaliseEgressEndpoint('   ')).toBeNull();
    expect(normaliseEgressEndpoint(`http://100.64.0.7:1080/${'x'.repeat(255)}`)).toBeNull();
    expect(normaliseEgressEndpoint('file:///etc/passwd')).toBeNull();
    expect(normaliseEgressEndpoint('ws://100.64.0.7:1080')).toBeNull();
    expect(normaliseEgressEndpoint('javascript:alert(1)')).toBeNull();
    // Credentials are refused rather than carried: Playwright takes them as their own fields, so a
    // `user:pass@` here is either a mistake or a smuggle through a field nobody reads.
    expect(normaliseEgressEndpoint('http://user:pass@100.64.0.7:1080')).toBeNull();
    expect(normaliseEgressEndpoint('http://100.64.0.7:1080/path')).toBeNull();
    expect(normaliseEgressEndpoint('http://100.64.0.7:1080/?x=1')).toBeNull();
    expect(normaliseEgressEndpoint('http://100.64.0.7:1080/#f')).toBeNull();
  });

  it('refuses loopback in every spelling, including the IPv4-mapped one', () => {
    expect(normaliseEgressEndpoint('http://127.0.0.1:8080')).toBeNull();
    expect(normaliseEgressEndpoint('http://127.1.2.3:8080')).toBeNull();
    expect(normaliseEgressEndpoint('http://localhost:8080')).toBeNull();
    expect(normaliseEgressEndpoint('http://LOCALHOST.:8080')).toBeNull();
    expect(normaliseEgressEndpoint('http://x.localhost:8080')).toBeNull();
    expect(normaliseEgressEndpoint('http://[::1]:8080')).toBeNull();
    // The spelling a check written against the TEXT rather than the address would miss.
    expect(normaliseEgressEndpoint('http://[::ffff:127.0.0.1]:8080')).toBeNull();
  });

  it('refuses link-local UNCONDITIONALLY - the dev switch does not reopen the metadata service', () => {
    const open = { allowPrivate: true };
    expect(normaliseEgressEndpoint('http://169.254.169.254:80')).toBeNull();
    expect(normaliseEgressEndpoint('http://169.254.169.254:80', open)).toBeNull();
    expect(normaliseEgressEndpoint('http://[fe80::1]:1080', open)).toBeNull();
    expect(normaliseEgressEndpoint('http://[::ffff:169.254.169.254]:80', open)).toBeNull();
    expect(normaliseEgressEndpoint('http://0.0.0.0:8080', open)).toBeNull();
    expect(normaliseEgressEndpoint('http://255.255.255.255:8080', open)).toBeNull();
    expect(normaliseEgressEndpoint('http://[ff02::1]:8080', open)).toBeNull();
  });

  it('refuses the RFC1918 ranges by default and only opens them on the explicit dev switch', () => {
    const closed = { allowPrivate: false };
    const open = { allowPrivate: true };
    for (const host of ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.1.1']) {
      expect(normaliseEgressEndpoint(`http://${host}:1080`, closed)).toBeNull();
      expect(normaliseEgressEndpoint(`http://${host}:1080`, open)).toBe(`http://${host}:1080`);
    }
    // 172.32.x is NOT in 172.16/12 and was never private.
    expect(normaliseEgressEndpoint('http://172.32.0.1:1080', closed)).toBe('http://172.32.0.1:1080');
    expect(normaliseEgressEndpoint('http://127.0.0.1:1080', open)).toBe('http://127.0.0.1:1080');
  });
});

describe('the grant authorises an ENDPOINT, not just a capability', () => {
  it('THE ATTACK: an advertised attacker proxy is never launched through, however the machine is granted', async () => {
    // The machine self-asserts the capability AND an attacker-controlled address.
    await registerPairing({
      pairingId: 'p1',
      org: ORG,
      ownerUserId: 'u1',
      capabilities: ['egress.residential'],
      egressEndpoint: 'http://attacker.example:8080',
    });
    // The admin authorises this MACHINE for residential egress - naming the address they believe
    // it has (the one on the machine list), which is not the one it just advertised.
    await grantCapability({
      orgId: ORG,
      pairingId: 'p1',
      capability: 'egress.residential',
      egressEndpoint: TAILNET,
      grantedByUserId: 'admin1',
    });

    const [candidate] = await candidates();
    expect(candidate?.capabilities).toEqual([]);
    expect(candidate?.egressEndpoint).toBeUndefined();

    const { resolution, proxy } = await proxyForResidentialRun();
    expect(resolution.outcome).toBe('refused');
    // The whole point: the hosted Chromium gets NO proxy option rather than the attacker's.
    expect(proxy).toBeUndefined();
  });

  it('a matching grant is the ONLY thing that produces a proxy, and it produces the granted one', async () => {
    await registerPairing({
      pairingId: 'p1',
      org: ORG,
      ownerUserId: 'u1',
      capabilities: ['egress.residential'],
      egressEndpoint: TAILNET,
    });
    // Before the grant: advertised, unauthorised, unusable.
    expect((await proxyForResidentialRun()).proxy).toBeUndefined();

    await grantCapability({
      orgId: ORG,
      pairingId: 'p1',
      capability: 'egress.residential',
      egressEndpoint: TAILNET,
      grantedByUserId: 'admin1',
    });
    const { resolution, proxy } = await proxyForResidentialRun();
    expect(resolution).toEqual({ outcome: 'machine', pairingId: 'p1', proxyUrl: TAILNET });
    expect(proxy).toEqual({ server: TAILNET });
  });

  it('the grant is matched CANONICALLY, so a re-spelling of the same address is the same authorisation', async () => {
    await registerPairing({
      pairingId: 'p1',
      org: ORG,
      ownerUserId: 'u1',
      capabilities: ['egress.residential'],
      egressEndpoint: '100.64.0.7:1080',
    });
    await grantCapability({
      orgId: ORG,
      pairingId: 'p1',
      capability: 'egress.residential',
      egressEndpoint: 'HTTP://100.64.0.7:1080/',
      grantedByUserId: 'admin1',
    });
    expect((await proxyForResidentialRun()).proxy).toEqual({ server: TAILNET });
  });

  it('A COMPROMISED DAEMON CANNOT MOVE THE DESTINATION: a changed endpoint fails closed with no new grant', async () => {
    await registerPairing({
      pairingId: 'p1',
      org: ORG,
      ownerUserId: 'u1',
      capabilities: ['egress.residential'],
      egressEndpoint: TAILNET,
    });
    await grantCapability({
      orgId: ORG,
      pairingId: 'p1',
      capability: 'egress.residential',
      egressEndpoint: TAILNET,
      grantedByUserId: 'admin1',
    });
    expect((await proxyForResidentialRun()).proxy).toEqual({ server: TAILNET });

    // The machine reconnects and advertises somewhere else. Nothing about the GRANT changed, and
    // no human was asked anything - which is exactly why this must stop working.
    await registerPairing({
      pairingId: 'p1',
      org: ORG,
      ownerUserId: 'u1',
      capabilities: ['egress.residential'],
      egressEndpoint: 'http://evil.example:3128',
    });
    const { resolution, proxy } = await proxyForResidentialRun();
    expect(proxy).toBeUndefined();
    expect(resolution.outcome).toBe('refused');
  });

  it('refuses to record a residential grant that names no endpoint - a grant with no route authorises nothing', async () => {
    await expect(
      grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'egress.residential', grantedByUserId: 'admin1' }),
    ).rejects.toThrow(/endpoint/i);
    // ...and one that names an unusable address is refused for the same reason: loudly, at the
    // moment a person decides, rather than silently at the moment a run needs it.
    await expect(
      grantCapability({
        orgId: ORG,
        pairingId: 'p1',
        capability: 'egress.residential',
        egressEndpoint: 'http://169.254.169.254:80',
        grantedByUserId: 'admin1',
      }),
    ).rejects.toThrow(/endpoint/i);
    expect(await bridgeCapabilityGrants.find({ orgId: ORG })).toEqual([]);
    // Every OTHER capability is unaffected: they authorise no route, so they name no address.
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'local.bash', grantedByUserId: 'admin1' });
    expect((await bridgeCapabilityGrants.find({ orgId: ORG })).length).toBe(1);
  });
});

describe('what the registry will store at all', () => {
  it('an unusable advertised address is not recorded, so it can never become a proxy target', async () => {
    for (const bad of ['http://127.0.0.1:8080', 'http://169.254.169.254:80', 'file:///etc/passwd', 'http://u:p@100.64.0.7:1080']) {
      await bridgePairings.deleteMany({});
      await registerPairing({ pairingId: 'p1', org: ORG, ownerUserId: 'u1', capabilities: ['egress.residential'], egressEndpoint: bad });
      expect((await getPairingById('p1'))?.egressEndpoint).toBeUndefined();
    }
  });

  it('stores the CANONICAL address, not the advertised spelling', async () => {
    await registerPairing({ pairingId: 'p1', org: ORG, ownerUserId: 'u1', capabilities: ['egress.residential'], egressEndpoint: '100.64.0.7:1080/' });
    expect((await getPairingById('p1'))?.egressEndpoint).toBe(TAILNET);
  });

  it('an advertisement with NO endpoint CLEARS the previous one, exactly as the capability list is replaced', async () => {
    await registerPairing({ pairingId: 'p1', org: ORG, ownerUserId: 'u1', capabilities: ['egress.residential'], egressEndpoint: TAILNET });
    expect((await getPairingById('p1'))?.egressEndpoint).toBe(TAILNET);

    // The operator removed the endpoint from the machine's config and restarted the daemon. Keeping
    // the old address here would mean a machine can never un-offer a route it once offered - the
    // same defect the capability list already avoids by REPLACING rather than merging.
    await registerPairing({ pairingId: 'p1', org: ORG, ownerUserId: 'u1', capabilities: ['egress.residential'], egressEndpoint: null });
    expect((await getPairingById('p1'))?.egressEndpoint).toBeUndefined();
  });

  it('a re-registration that is not an advertisement (the connect path) KEEPS what was advertised', async () => {
    await registerPairing({ pairingId: 'p1', org: ORG, ownerUserId: 'u1', capabilities: ['egress.residential'], egressEndpoint: TAILNET });
    // No `capabilities`, no `egressEndpoint`: `bridge/server.ts` registers the pairing at CONNECT,
    // before the machine has said anything about itself.
    await registerPairing({ pairingId: 'p1', org: ORG, ownerUserId: 'u1' });
    expect((await getPairingById('p1'))?.egressEndpoint).toBe(TAILNET);
  });

  it('shows the admin surface WHAT it would be authorising, not only the capability name', async () => {
    // The person granting `egress.residential` is authorising a destination. A surface that returns
    // capability NAMES alone cannot show them the address, which is how an attacker-supplied one
    // gets authorised by someone who never saw it.
    await registerPairing({ pairingId: 'p1', org: ORG, ownerUserId: 'u1', capabilities: ['egress.residential'], egressEndpoint: TAILNET });
    expect(await advertisedCapabilitiesForOrg(ORG)).toEqual([
      { pairingId: 'p1', advertised: ['egress.residential'], egressEndpoint: TAILNET },
    ]);
  });
});
