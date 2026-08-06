import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// dados-omissao.js (auto-sementeira) e seed-data.json (forks da plataforma)
// têm de ser o MESMO conteúdo - divergência seria dois arranques diferentes.
test('dados-omissao.js espelha seed-data.json', async () => {
  // engine/tests -> src -> frontend -> scaffold -> A RAIZ DO ARTEFACTO. seed-data.json fica na
  // raiz (ao lado de manifest.json), como em todos os artefactos destacados; o caminho original
  // parava em scaffold/ e o teste falhava com ENOENT em vez de comparar o que quer que fosse.
  const scaffold = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const raiz = join(scaffold, '..');
  const seed = JSON.parse(readFileSync(join(raiz, 'seed-data.json'), 'utf8'));
  const src = readFileSync(join(scaffold, 'frontend', 'src', 'dados-omissao.js'), 'utf8');
  const m = src.match(/export const DADOS_OMISSAO = ([\s\S]*?);\n\nlet /);
  assert.ok(m, 'bloco DADOS_OMISSAO não encontrado');
  assert.deepEqual(JSON.parse(m[1]), seed);
});
