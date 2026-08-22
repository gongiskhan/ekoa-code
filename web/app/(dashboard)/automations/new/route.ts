/**
 * S8: `/automations/new` is GONE, and says so with the status that means gone.
 *
 * A ROUTE HANDLER RATHER THAN A PAGE, because 410 is the point. Next's `notFound()` answers 404 -
 * "we have no idea what this is" - and a page cannot set a status of its own. This address had a
 * meaning and no longer has one, which is exactly what 410 states: authoring lives on the
 * integration builder now, and a link or a bookmark to this path should be corrected rather than
 * retried. A route handler and a page cannot coexist on one segment, so the page is deleted.
 *
 * NOT A REDIRECT, deliberately. The two sibling routes redirect because their destinations still
 * answer the same question (which integrations do I have, what does this one do). This one has no
 * destination that answers "create an automation": nothing in the product does that any more, and a
 * redirect that quietly lands somebody on a list is a worse answer than a plain one.
 *
 * The body is PT-PT, the product's default language, and carries the one link worth following. It
 * is deliberately not translated: a route handler has no locale store, and inventing a second copy
 * of the language decision to serve six words would be the drift this repo keeps closing elsewhere.
 */
export function GET(): Response {
  return new Response(
    '<!doctype html><html lang="pt"><meta charset="utf-8">' +
      '<title>410 - Esta página foi removida</title>' +
      '<p>Esta página foi removida. As integrações passaram a ser o único lugar onde este trabalho se cria.</p>' +
      '<p><a href="/integrations">Ir para as integrações</a></p>',
    { status: 410, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
