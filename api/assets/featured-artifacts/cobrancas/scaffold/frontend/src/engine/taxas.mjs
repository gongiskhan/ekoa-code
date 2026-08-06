/*
 * Tabela de taxas VENDORIZADA (snapshot) - fonte única: ekoa-data/legal-engines/
 * tabelas-taxas.json da plataforma Ekoa. O motor de juros (juros.mjs, vendorizado
 * de legal-calculos) recebe estas linhas como argumento e cita o aviso de cada
 * troco; nenhuma outra constante de taxa pode viver no codigo da app.
 *
 * Linhas com nota 'confirmar' tem valor/aviso por validar contra o DRE - a UI
 * mostra sempre essa reserva. A indemnizacao fixa por custos de cobranca
 * (transacoes comerciais) e de 40 EUR - Decreto-Lei n.º 62/2013, art. 7.º -
 * configuravel por perfil (por omissao 40).
 */
export const TABELA_TAXAS = {
  "vendoradoDe": "ekoa-data/legal-engines/tabelas-taxas.json (versao 1, 2026-07-04)",
  "jurosCivis": {
    "taxa": 4.0,
    "base": "Portaria n.º 291/2003, de 8 de abril (art. 559.º do Código Civil)",
    "vigenciaInicio": "2003-05-01"
  },
  "jurosComerciais": [
    {
      "semestre": "2019-S1",
      "taxa": 8.0,
      "aviso": "confirmar",
      "vigenciaInicio": "2019-01-01",
      "vigenciaFim": "2019-06-30",
      "nota": "confirmar - taxa BCE 0,00% + 8 p.p.; aviso DGTF por validar"
    },
    {
      "semestre": "2019-S2",
      "taxa": 8.0,
      "aviso": "confirmar",
      "vigenciaInicio": "2019-07-01",
      "vigenciaFim": "2019-12-31",
      "nota": "confirmar - taxa BCE 0,00% + 8 p.p.; aviso DGTF por validar"
    },
    {
      "semestre": "2020-S1",
      "taxa": 8.0,
      "aviso": "Aviso n.º 1568/2020, DGTF",
      "vigenciaInicio": "2020-01-01",
      "vigenciaFim": "2020-06-30"
    },
    {
      "semestre": "2020-S2",
      "taxa": 8.0,
      "aviso": "Aviso n.º 10874/2020, DGTF",
      "vigenciaInicio": "2020-07-01",
      "vigenciaFim": "2020-12-31",
      "nota": "confirmar"
    },
    {
      "semestre": "2021-S1",
      "taxa": 8.0,
      "aviso": "Aviso n.º 2239/2021, DGTF",
      "vigenciaInicio": "2021-01-01",
      "vigenciaFim": "2021-06-30",
      "nota": "confirmar"
    },
    {
      "semestre": "2021-S2",
      "taxa": 8.0,
      "aviso": "Aviso n.º 13486/2021, DGTF",
      "vigenciaInicio": "2021-07-01",
      "vigenciaFim": "2021-12-31",
      "nota": "confirmar"
    },
    {
      "semestre": "2022-S1",
      "taxa": 8.0,
      "aviso": "Aviso n.º 2062/2022, DGTF",
      "vigenciaInicio": "2022-01-01",
      "vigenciaFim": "2022-06-30",
      "nota": "confirmar"
    },
    {
      "semestre": "2022-S2",
      "taxa": 8.0,
      "aviso": "Aviso n.º 14201/2022, DGTF",
      "vigenciaInicio": "2022-07-01",
      "vigenciaFim": "2022-12-31",
      "nota": "confirmar - taxa BCE em vigor a 1 Jul 2022 era 0,00% (a primeira subida produziu efeitos a 27 Jul), logo 0,00 + 8 p.p."
    },
    {
      "semestre": "2023-S1",
      "taxa": 10.5,
      "aviso": "Aviso n.º 1261/2023, DGTF",
      "vigenciaInicio": "2023-01-01",
      "vigenciaFim": "2023-06-30"
    },
    {
      "semestre": "2023-S2",
      "taxa": 12.0,
      "aviso": "Aviso n.º 20214/2023, DGTF",
      "vigenciaInicio": "2023-07-01",
      "vigenciaFim": "2023-12-31"
    },
    {
      "semestre": "2024-S1",
      "taxa": 12.5,
      "aviso": "Aviso n.º 1274/2024, DGTF",
      "vigenciaInicio": "2024-01-01",
      "vigenciaFim": "2024-06-30"
    },
    {
      "semestre": "2024-S2",
      "taxa": 12.25,
      "aviso": "Aviso n.º 15332/2024, DGTF",
      "vigenciaInicio": "2024-07-01",
      "vigenciaFim": "2024-12-31",
      "nota": "confirmar"
    },
    {
      "semestre": "2025-S1",
      "taxa": 11.15,
      "aviso": null,
      "vigenciaInicio": "2025-01-01",
      "vigenciaFim": "2025-06-30",
      "nota": "confirmar - taxa BCE 3,15% + 8 p.p.; numero do Aviso DGTF por obter no DRE (nunca citar um aviso inventado)"
    },
    {
      "semestre": "2025-S2",
      "taxa": 10.15,
      "aviso": null,
      "vigenciaInicio": "2025-07-01",
      "vigenciaFim": "2025-12-31",
      "nota": "confirmar - taxa BCE 2,15% + 8 p.p.; numero do Aviso DGTF por obter no DRE"
    },
    {
      "semestre": "2026-S1",
      "taxa": 10.15,
      "aviso": null,
      "vigenciaInicio": "2026-01-01",
      "vigenciaFim": "2026-06-30",
      "nota": "confirmar - taxa BCE 2,15% + 8 p.p.; numero do Aviso DGTF por obter no DRE"
    },
    {
      "semestre": "2026-S2",
      "taxa": 10.15,
      "aviso": null,
      "vigenciaInicio": "2026-07-01",
      "vigenciaFim": "2026-12-31",
      "nota": "confirmar - taxa BCE 2,15% + 8 p.p.; numero do Aviso DGTF por obter no DRE (o crawler/checkpoint saram)"
    }
  ]
};

/* Indemnizacao minima por custos de recuperacao (DL 62/2013, art. 7.º). */
export const CUSTO_RECUPERACAO_EUR = 40;
export const CUSTO_RECUPERACAO_BASE = 'Decreto-Lei n.º 62/2013, de 10 de maio, art. 7.º (indemnização mínima de 40 EUR por custos de cobrança em transações comerciais)';
