// Aba Sugestões: renda fixa, FIIs/Fiagros e ETFs com rendimento atual e tendência de 12 meses.

dash.calc('sug_cenario', {
  inputs: ['juros'],
  title: 'CDI esperado para os próximos 12 meses',
  description: 'Média mensal da Selic nos próximos 12 meses, indo em linha reta da taxa atual até a mediana do Focus para o fim deste ano e do próximo; o CDI fica 0,10 ponto abaixo da Selic.',
  fn: (juros) => {
    const j = juros[0];
    if (!j) return [];
    const mes = Number(String(j.data_cdi || '').slice(5, 7)) || 10;
    const ate0 = Math.max(1, 12 - mes);  // meses até dezembro deste ano
    let soma = 0;
    for (let k = 1; k <= 12; k++) {
      soma += k <= ate0 ? j.selic + (j.selic_f0 - j.selic) * k / ate0 : j.selic_f0 + (j.selic_f1 - j.selic_f0) * (k - ate0) / 12;
    }
    const selic12 = soma / 12;
    return [{cdi: j.cdi, selic: j.selic, selic12: Math.round(selic12 * 100) / 100, cdi12: Math.round((selic12 - 0.1) * 100) / 100,
      selic_f0: j.selic_f0, selic_f1: j.selic_f1, ano0: j.ano0, ano1: j.ano1, ipca: j.ipca_12m, ipca_f1: j.ipca_f1}];
  },
});

dash.calc('sug_rf', {
  inputs: ['sug_cenario', 'tesouro'],
  title: 'Renda fixa: rendimento líquido hoje e nos próximos 12 meses',
  description: 'Para cada prazo de resgate (IR de 22,5%, 20%, 17,5% e 15%): rendimento líquido com as taxas de hoje e com o CDI e o IPCA esperados pelo Focus, e quanto R$ 1.000 rendem em 12 meses na tendência. Tesouro prefixado e IPCA+ descontam 0,20% de custódia.',
  fn: (sug_cenario, tesouro) => {
    const c = sug_cenario[0];
    if (!c) return [];
    const PRAZOS = {'6m': 0.225, '1a': 0.2, '2a': 0.175, '2amais': 0.15};
    const r2 = (x) => Math.round(x * 100) / 100;
    const ano = Number(c.ano0);
    const titulo = (tipo, anoMin) => tesouro.filter((t) => t.tipo === tipo).sort((a, b) => a.vencimento.localeCompare(b.vencimento)).find((t) => Number(t.vencimento.slice(0, 4)) >= anoMin);
    const poup = (s) => s > 8.5 ? (Math.pow(1.005, 12) - 1) * 100 : s * 0.7;
    const itens = [
      {nome: 'CDB liquidez diária 100% do CDI', oque: 'Empréstimo a um banco; rende o CDI do dia', segmento: 'Pós-fixado (CDI)', hoje: c.cdi, tend: c.cdi12,
        liquidez: 'Imediata (D+0)', garantia: 'FGC até R$ 250 mil', ir: 'Regressivo', indicada: 'Reserva de emergência', reserva: true},
    ];
    const sel = titulo('Tesouro Selic', ano + 2);
    if (sel) itens.push({nome: sel.titulo, oque: 'Título público que rende a Selic', segmento: 'Pós-fixado (Selic)', hoje: c.cdi + Number(sel.taxa_compra), tend: c.cdi12 + Number(sel.taxa_compra),
      liquidez: 'D+1', garantia: 'Tesouro Nacional', ir: 'Regressivo', indicada: 'Reserva de emergência', obs: 'Sem custódia até R$ 10 mil', reserva: true});
    itens.push(
      {nome: 'LCI/LCA 90% do CDI (referência)', oque: 'Crédito imobiliário ou do agro emitido por banco', segmento: 'Pós-fixado (CDI), isento', hoje: c.cdi * 0.9, tend: c.cdi12 * 0.9, isento: true, min_meses: 9,
        liquidez: 'Carência de 9 a 12 meses', garantia: 'FGC até R$ 250 mil', ir: 'Isento', indicada: 'Dinheiro parado por 1 ano ou mais', obs: 'Taxa de referência: confira a oferta real'},
      {nome: 'CDB 110% do CDI (referência)', oque: 'Empréstimo a banco médio, com prazo', segmento: 'Pós-fixado (CDI)', hoje: c.cdi * 1.1, tend: c.cdi12 * 1.1,
        liquidez: 'No vencimento', garantia: 'FGC até R$ 250 mil', ir: 'Regressivo', indicada: 'Médio prazo', obs: 'Taxa de referência: confira a oferta real'});
    const pre = titulo('Tesouro Prefixado', ano + 3);
    if (pre) itens.push({nome: pre.titulo, oque: 'Título público com taxa fixa até o vencimento', segmento: 'Prefixado', hoje: Number(pre.taxa_compra), tend: Number(pre.taxa_compra), custodia: 0.2,
      liquidez: 'D+1, a preço de mercado', garantia: 'Tesouro Nacional', ir: 'Regressivo', indicada: 'Travar juro alto antes da queda da Selic', obs: 'Taxa garantida só se levar até o vencimento'});
    [ano + 3, ano + 9].forEach((a) => {
      const t = titulo('Tesouro IPCA+', a);
      if (!t || itens.some((x) => x.nome === t.titulo)) return;
      const real = Number(t.taxa_compra);
      itens.push({nome: t.titulo, oque: 'Título público: inflação + juro real fixo', segmento: 'Inflação (IPCA+)',
        hoje: ((1 + real / 100) * (1 + c.ipca / 100) - 1) * 100, tend: ((1 + real / 100) * (1 + (c.ipca_f1 ?? c.ipca) / 100) - 1) * 100, custodia: 0.2,
        liquidez: 'D+1, a preço de mercado', garantia: 'Tesouro Nacional', ir: 'Regressivo', indicada: 'Longo prazo, proteção contra inflação',
        obs: `Juro real de ${String(real).replace('.', ',')}% garantido no vencimento`});
    });
    itens.push({nome: 'Poupança', oque: 'Conta de poupança', segmento: 'Regra da Selic', hoje: poup(c.selic), tend: poup(c.selic12), isento: true,
      liquidez: 'Imediata (rende no aniversário mensal)', garantia: 'FGC até R$ 250 mil', ir: 'Isento', indicada: 'Não recomendada: rende cerca de metade do CDI', evitar: true});
    return itens.map((x) => {
      const out = {nome: x.nome, oque: x.oque, segmento: x.segmento, liquidez: x.liquidez, garantia: x.garantia, ir: x.ir, indicada: x.indicada,
        obs: x.obs || '', reserva: !!x.reserva, evitar: !!x.evitar, bruta_hoje: r2(x.hoje), bruta_tend: r2(x.tend)};
      Object.entries(PRAZOS).forEach(([k, ir]) => {
        const indisponivel = x.min_meses && ((k === '6m' && x.min_meses > 6) || (k === '1a' && x.min_meses > 12));
        const liq = (b) => (x.isento ? b : b * (1 - ir)) - (x.custodia || 0);
        out['liq_atual_' + k] = indisponivel ? null : r2(liq(x.hoje));
        out['liq_tend_' + k] = indisponivel ? null : r2(liq(x.tend));
        out['mil_' + k] = indisponivel ? null : Math.round(10 * liq(x.tend)) ;
        out['pct_cdi_' + k] = indisponivel ? null : Math.round(liq(x.hoje) / (c.cdi * (1 - ir)) * 100);
      });
      return out;
    });
  },
});

dash.calc('sug_fii', {
  inputs: ['fundos', 'sug_cenario'],
  title: 'FIIs e Fiagros: DY hoje e tendência',
  description: 'DY de 12 meses (rendimentos por cota informados à CVM ÷ cotação), tendência do DY (crédito: × CDI esperado ÷ CDI atual; imóveis: × 1 + IPCA esperado), P/VP, volume diário em reais e cotistas. Fundos com menos de 50 mil cotistas ficam fora; com P/VP abaixo de 0,8, marcados como dado inconsistente.',
  fn: (fundos, sug_cenario) => {
    const c = sug_cenario[0];
    if (!c) return [];
    const credito = ['Papel (CRI)', 'Fiagro (CRA)'];
    const rows = fundos.filter((f) => f.preco && f.vp_cota && f.rend_12m_cota && (f.cotistas || 0) >= 50000).map((f) => {
      const preco = Number(f.preco), dy = Number(f.rend_12m_cota) / preco * 100, pvp = preco / Number(f.vp_cota);
      const ehCredito = credito.includes(f.segmento);
      const tend = ehCredito ? dy * c.cdi12 / c.cdi : dy * (1 + (c.ipca_f1 ?? c.ipca) / 100);
      return {ticker: f.ticker, segmento: f.segmento, tipo: f.segmento === 'Papel (CRI)' ? 'FII de papel (CRI)' : f.segmento === 'Fiagro (CRA)' ? 'Fiagro (CRA)' : 'FII de imóveis',
        dy: Math.round(dy * 10) / 10, dy_tend: Math.round(tend * 10) / 10, regra: ehCredito ? 'Acompanha os juros: cai com a Selic' : 'Aluguéis reajustados pela inflação',
        p_vp: Math.round(pvp * 100) / 100, volume_rs: Math.round((Number(f.volume) || 0) * preco), cotistas: Number(f.cotistas), na_carteira: !!f.na_carteira,
        inconsistente: pvp < 0.8};
    });
    const melhor = {};
    rows.filter((r) => !r.inconsistente && !r.na_carteira && r.p_vp <= 1).forEach((r) => { if (!melhor[r.segmento] || r.dy_tend > melhor[r.segmento].dy_tend) melhor[r.segmento] = r; });
    return rows.map((r) => ({...r, destaque: melhor[r.segmento] === r}));
  },
});

dash.calc('sug_etf', {
  inputs: ['etfs'],
  title: 'ETFs: retorno de 12 meses',
  description: 'Retorno de 12 meses pela cotação de fechamento da B3, posição na faixa de 52 semanas e volume diário em reais.',
  fn: (etfs) => etfs.filter((e) => e.retorno_12m != null && e.preco).map((e) => ({
    ticker: e.ticker, descricao: e.descricao, retorno_12m: Number(e.retorno_12m), preco: Number(e.preco),
    posicao_52s: e.max52 > e.min52 ? Math.round((e.preco - e.min52) / (e.max52 - e.min52) * 100) : null,
    min52: e.min52, max52: e.max52, volume_rs: Math.round((Number(e.volume) || 0) * Number(e.preco)), desde: e.desde,
  })),
});

dash.calc('sim_taxas', {
  inputs: ['sug_cenario', 'focus', 'tesouro', 'sug_fii', 'sug_etf'],
  title: 'Taxas projetadas para o simulador',
  description: 'Taxa bruta anual de cada investimento, ano a ano por 20 anos. CDI: média esperada dos próximos 12 meses no 1º ano; depois, a média entre a Selic de fim de ano do Focus de um ano e do seguinte (menos 0,10), ficando no último valor do Focus a partir daí. IPCA: mediana do Focus de cada ano, depois o último valor. FIIs de crédito: DY × CDI do ano ÷ CDI atual; FIIs de imóveis: DY + 80% do IPCA (valorização da cota, com 20% de IR na venda). ETFs: inflação + 6% ao ano como ponto de partida editável.',
  fn: (sug_cenario, focus, tesouro, sug_fii, sug_etf) => {
    const c = sug_cenario[0];
    if (!c) return [];
    const N = 20;
    const serie = (ind) => { const m = {}; focus.filter((f) => f.indicador === ind).forEach((f) => { m[Number(f.ano)] = Number(f.mediana); }); return m; };
    const selicFim = serie('Selic'), ipcaAno = serie('IPCA');
    const anosS = Object.keys(selicFim).map(Number).sort(), anosI = Object.keys(ipcaAno).map(Number).sort();
    const fimDe = (a) => selicFim[Math.min(Math.max(a, anosS[0]), anosS[anosS.length - 1])];
    const ipcaDe = (a) => ipcaAno[Math.min(Math.max(a, anosI[0]), anosI[anosI.length - 1])];
    const a0 = Number(c.ano0);
    const cdi = [], ipca = [];
    for (let y = 1; y <= N; y++) {
      cdi.push(y === 1 ? c.cdi12 : (fimDe(a0 + y - 1) + fimDe(a0 + y)) / 2 - 0.1);
      ipca.push(y === 1 ? (c.ipca_f1 ?? c.ipca) : ipcaDe(a0 + y));
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    const linha = (o) => ({...o, taxas: o.taxas.map(r2)});
    const titulo = (tipo, anoMin) => tesouro.filter((t) => t.tipo === tipo).sort((a, b) => a.vencimento.localeCompare(b.vencimento)).find((t) => Number(t.vencimento.slice(0, 4)) >= anoMin);
    const anosAte = (venc) => Math.max(1, Math.round((new Date(venc) - new Date(`${a0}-11-01`)) / (365.25 * 864e5)));
    const out = [];
    const RF = 'Renda fixa';
    out.push({id: 'cdi100', grupo: RF, nome: 'CDB liquidez diária 100% do CDI', taxas: cdi.slice(), isento: false, custodia: 0, ir: 'regressivo', regra: '100% do CDI esperado'});
    out.push({id: 'cdb110', grupo: RF, nome: 'CDB 110% do CDI (referência)', taxas: cdi.map((x) => x * 1.1), isento: false, custodia: 0, ir: 'regressivo', regra: '110% do CDI esperado'});
    out.push({id: 'lci90', grupo: RF, nome: 'LCI/LCA 90% do CDI (referência)', taxas: cdi.map((x) => x * 0.9), isento: true, custodia: 0, ir: 'isento', regra: '90% do CDI esperado, isento'});
    const sel = titulo('Tesouro Selic', a0 + 2);
    if (sel) out.push({id: 'selic', grupo: RF, nome: sel.titulo, taxas: cdi.map((x) => x + 0.1 + Number(sel.taxa_compra)), isento: false, custodia: 0, ir: 'regressivo', regra: `Selic esperada + ${sel.taxa_compra}%; reaplicado no vencimento`});
    const pre = titulo('Tesouro Prefixado', a0 + 3);
    if (pre) { const m = anosAte(pre.vencimento); out.push({id: 'pre', grupo: RF, nome: pre.titulo, taxas: cdi.map((x, i) => i < m ? Number(pre.taxa_compra) : x), isento: false, custodia: 0.2, ir: 'regressivo', regra: `${pre.taxa_compra}% até o vencimento; depois, CDI`}); }
    [a0 + 3, a0 + 9].forEach((a, k) => {
      const t = titulo('Tesouro IPCA+', a);
      if (!t) return;
      const m = anosAte(t.vencimento), real = Number(t.taxa_compra);
      out.push({id: k ? 'ipca_longo' : 'ipca_curto', grupo: RF, nome: t.titulo, taxas: ipca.map((x, i) => i < m ? ((1 + real / 100) * (1 + x / 100) - 1) * 100 : cdi[i]),
        isento: false, custodia: 0.2, ir: 'regressivo', regra: `IPCA esperado + ${real}% até o vencimento; depois, CDI`});
    });
    out.push({id: 'poupanca', grupo: RF, nome: 'Poupança', taxas: cdi.map((x) => (x + 0.1) > 8.5 ? (Math.pow(1.005, 12) - 1) * 100 : (x + 0.1) * 0.7), isento: true, custodia: 0, ir: 'isento', regra: '0,5% ao mês acima de Selic 8,5%; senão 70% da Selic (sem TR)'});
    sug_fii.filter((f) => !f.inconsistente).sort((a, b) => a.segmento.localeCompare(b.segmento) || a.ticker.localeCompare(b.ticker)).forEach((f) => {
      const credito = ['Papel (CRI)', 'Fiagro (CRA)'].includes(f.segmento);
      out.push({id: 'fii_' + f.ticker, grupo: 'FIIs e Fiagros', nome: `${f.ticker} · ${f.segmento}`, isento: true, custodia: 0, ir: 'isento',
        taxas: credito ? cdi.map((x) => f.dy * x / c.cdi) : ipca.map((x) => f.dy + x * 0.8),
        regra: credito ? `DY de ${f.dy}% acompanhando o CDI, rendimentos reinvestidos, cota estável` : `DY de ${f.dy}% + valorização da cota pela inflação (com 20% de IR na venda), rendimentos reinvestidos`});
    });
    sug_etf.forEach((e) => out.push({id: 'etf_' + e.ticker, grupo: 'ETFs', nome: `${e.ticker} · ${e.descricao}`, taxas: ipca.map((x) => x + 6), isento: false, custodia: 0, ir: '15%', editavel: true,
      regra: `Sem projeção oficial: começa em inflação + 6% ao ano (edite). Nos últimos 12 meses rendeu ${String(e.retorno_12m).replace('.', ',')}%`}));
    return out.map(linha);
  },
});

(() => {
  const F = window.pfFmt;
  const pc = (v, n = 2) => v == null ? '—' : Number(v).toLocaleString('pt-BR', {minimumFractionDigits: n, maximumFractionDigits: n}) + '%';
  const mi = (v) => 'R$ ' + (v / 1e6).toLocaleString('pt-BR', {maximumFractionDigits: v >= 1e8 ? 0 : 1}) + ' mi';
  const el = (tag, attrs, text) => { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); if (text != null) e.textContent = text; return e; };
  const failed = (host, d) => { if (d.status === 'error') host.innerHTML = '<tr><td colspan="8"><div class="pf-err">Falhou ao carregar</div></td></tr>'; else host.replaceChildren(); };
  const SUF = {'6m': '6m', '1a': '1a', '2a': '2a', '2a+': '2amais'};
  const NOME_PRAZO = {'6m': 'até 6 meses (IR 22,5%)', '1a': 'até 1 ano (IR 20%)', '2a': 'de 1 a 2 anos (IR 17,5%)', '2a+': 'acima de 2 anos (IR 15%)'};

  document.getElementById('sg-prazo').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (b) dash.setParams({prazo_sug: b.dataset.p}); });
  const segSel = document.getElementById('sg-seg');
  segSel.addEventListener('change', () => dash.setParams({seg_sug: segSel.value || null}));
  let ordem = {k: 'dy_tend', desc: true};
  document.querySelector('#sg-fii thead').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    ordem = {k: b.dataset.k, desc: ordem.k === b.dataset.k ? !ordem.desc : !['ticker', 'segmento', 'p_vp'].includes(b.dataset.k)};
    fiis();
  });

  // Simulador
  const simSel = document.getElementById('sim-ativo'), simIni = document.getElementById('sim-inicial'), simAp = document.getElementById('sim-aporte');
  const simTaxa = document.getElementById('sim-taxa'), simTaxaBox = document.getElementById('sim-taxa-box');
  let taxaEditada = null;
  simSel.addEventListener('change', () => { taxaEditada = null; simulador(); });
  [simIni, simAp].forEach((i) => i.addEventListener('input', simulador));
  simTaxa.addEventListener('input', () => { taxaEditada = simTaxa.value === '' ? null : Number(simTaxa.value); simulador(); });
  const HORIZ = [1, 2, 5, 10, 20];
  const irDe = (row, anos) => row.isento ? 0 : row.ir === '15%' ? 0.15 : anos < 2 ? 0.175 : 0.15;

  function projetar(row, taxas, inicial, aporte) {
    const out = {};
    let saldo = inicial, investido = inicial;
    for (let m = 1; m <= 12 * 20; m++) {
      const r = taxas[Math.ceil(m / 12) - 1];
      saldo = saldo * Math.pow(1 + r / 100, 1 / 12) * (1 - (row.custodia || 0) / 100 / 12) + aporte;
      investido += aporte;
      if (m % 12 === 0 && HORIZ.includes(m / 12)) {
        const ganho = saldo - investido, ir = ganho > 0 ? ganho * irDe(row, m / 12) : 0;
        out[m / 12] = {liquido: saldo - ir, ganho: ganho - ir, investido};
      }
    }
    const a1 = ((1 + taxas[0] / 100) * (1 - (row.custodia || 0) / 100) - 1) * (1 - irDe(row, 1)) * 100;
    return {anual: a1, mensal: (Math.pow(1 + a1 / 100, 1 / 12) - 1) * 100, h: out};
  }

  function simulador() {
    const d = dash.data('sim_taxas'), tab = document.getElementById('sim-tab');
    const th = tab.querySelector('thead tr'), tb = tab.querySelector('tbody');
    if (d.status !== 'ok' || !d.data.length) { th.replaceChildren(); if (d.status === 'error') tb.innerHTML = '<tr><td><div class="pf-err">Falhou ao carregar</div></td></tr>'; else tb.replaceChildren(); return; }
    if (!simSel.options.length) {
      const grupos = {};
      d.data.forEach((r) => { (grupos[r.grupo] = grupos[r.grupo] || []).push(r); });
      Object.entries(grupos).forEach(([g, rows]) => { const og = document.createElement('optgroup'); og.label = g; rows.forEach((r) => og.append(new Option(r.nome, r.id))); simSel.append(og); });
      simSel.value = 'lci90';
    }
    const por = Object.fromEntries(d.data.map((r) => [r.id, r]));
    const escolhido = por[simSel.value] || d.data[0];
    simTaxaBox.hidden = !escolhido.editavel;
    if (escolhido.editavel && taxaEditada == null && simTaxa !== document.activeElement) simTaxa.value = escolhido.taxas[0];
    document.getElementById('sim-regra').textContent = `${escolhido.nome}: ${escolhido.regra}.`;
    const inicial = Math.max(0, Number(simIni.value) || 0), aporte = Math.max(0, Number(simAp.value) || 0);
    const colunas = [{row: escolhido, titulo: 'Investimento selecionado', sub: escolhido.nome, sel: true},
      {row: por.cdi100, titulo: '100% do CDI', sub: 'CDB liquidez diária'}, {row: por.selic, titulo: 'Tesouro Selic', sub: por.selic && por.selic.nome},
      {row: por.ipca_longo || por.ipca_curto, titulo: 'Tesouro IPCA+', sub: (por.ipca_longo || por.ipca_curto || {}).nome}, {row: por.poupanca, titulo: 'Poupança', sub: 'regra atual'}].filter((c) => c.row);
    colunas.forEach((c) => {
      const taxas = c.sel && escolhido.editavel && taxaEditada != null ? escolhido.taxas.map(() => taxaEditada) : c.row.taxas;
      c.p = projetar(c.row, taxas, inicial, aporte);
    });
    th.replaceChildren(el('th', {}, ''), ...colunas.map((c) => { const h = el('th', {class: 'n' + (c.sel ? ' sim-sel' : '')}); h.append(document.createTextNode(c.titulo), el('div', {class: 'sub'}, c.sub || '')); return h; }));
    const linhas = [['Rendimento anual (%)', (c) => [pc(c.p.anual), 'líquido no 1º ano']], ['Rendimento mensal (%)', (c) => [pc(c.p.mensal, 3), 'equivalente ao mês']]]
      .concat(HORIZ.map((n) => [`Rendimento em ${n} ${n === 1 ? 'ano' : 'anos'} (R$)`, (c) => [F.brl(c.p.h[n].ganho), `saldo ${F.brl(c.p.h[n].liquido)}`]]));
    const melhor = (fn) => Math.max(...colunas.map((c) => fn(c)));
    tb.replaceChildren(...linhas.map(([rotulo, f], i) => {
      const tr = el('tr', {});
      tr.append(el('td', {}, rotulo));
      const valorDe = (c) => i === 0 ? c.p.anual : i === 1 ? c.p.mensal : c.p.h[HORIZ[i - 2]].ganho;
      const top = melhor(valorDe);
      colunas.forEach((c) => {
        const [v, s] = f(c), td = el('td', {class: 'n' + (c.sel ? ' sim-sel' : '')});
        const b = el('b', {}, v); if (Math.abs(valorDe(c) - top) < 0.005) b.className = 'iv-pos';
        td.append(b, el('div', {class: 'sub'}, s));
        tr.append(td);
      });
      return tr;
    }));
    const inv = colunas[0].p.h;
    document.getElementById('sim-regra').append(document.createTextNode(` Total investido: ${F.brl(inv[1].investido)} em 1 ano, ${F.brl(inv[5].investido)} em 5 anos, ${F.brl(inv[20].investido)} em 20 anos.`));
  }

  function seta(hoje, tend) {
    if (hoje == null || tend == null) return ['iv-muted', ''];
    return tend < hoje - 0.05 ? ['iv-neg', '▼ '] : tend > hoje + 0.05 ? ['iv-pos', '▲ '] : ['iv-muted', '= '];
  }

  function rf() {
    const d = dash.data('sug_rf'), tb = document.querySelector('#sg-rf tbody');
    const prazo = dash.params().prazo_sug || '2a', s = SUF[prazo] || '2a';
    document.querySelectorAll('#sg-prazo button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === prazo)));
    document.getElementById('sg-rf-atual').setAttribute('data-field', 'liq_atual_' + s);
    document.getElementById('sg-rf-tend').setAttribute('data-field', 'liq_tend_' + s);
    document.getElementById('sg-rf-mil').setAttribute('data-field', 'mil_' + s);
    if (d.status !== 'ok') { failed(tb, d); return; }
    const reservas = d.data.filter((r) => r.reserva && r['liq_tend_' + s] != null);
    const melhorReserva = reservas.sort((a, b) => b['liq_tend_' + s] - a['liq_tend_' + s])[0];
    const maior = d.data.filter((r) => r['liq_tend_' + s] != null).sort((a, b) => b['liq_tend_' + s] - a['liq_tend_' + s])[0];
    tb.replaceChildren(...d.data.map((r) => {
      const tr = el('tr', {});
      const nome = el('td', {});
      nome.append(el('b', {}, r.nome), el('div', {class: 'sub'}, r.oque));
      const selos = el('div', {});
      if (r.evitar) selos.append(el('span', {class: 'pf-st critical'}, '✕ Evitar'));
      if (r === melhorReserva) selos.append(el('span', {class: 'pf-st good'}, '✓ Melhor para a reserva'));
      if (r === maior && r !== melhorReserva) selos.append(el('span', {class: 'pf-st good'}, '✓ Maior rendimento no prazo'));
      if (selos.childNodes.length) nome.append(selos);
      const atual = r['liq_atual_' + s], tend = r['liq_tend_' + s], [cls, sg] = seta(atual, tend);
      const a = el('td', {class: 'n'});
      a.append(el('b', {}, atual == null ? 'Indisponível' : pc(atual)), el('div', {class: 'sub'}, atual == null ? 'carência maior que o prazo' : `${r['pct_cdi_' + s]}% do CDI líquido`));
      const gar = el('td', {}); gar.append(document.createTextNode(r.garantia), el('div', {class: 'sub'}, 'IR: ' + r.ir));
      const ind = el('td', {}); ind.append(document.createTextNode(r.indicada)); if (r.obs) ind.append(el('div', {class: 'sub'}, r.obs));
      tr.append(nome, el('td', {}, r.segmento), a, el('td', {class: 'n ' + cls}, tend == null ? '—' : sg + pc(tend)),
        el('td', {class: 'n'}, r['mil_' + s] == null ? '—' : '+R$ ' + r['mil_' + s].toLocaleString('pt-BR')), el('td', {}, r.liquidez), gar, ind);
      return tr;
    }));
    const n = document.querySelector('#sug-renda-fixa .pf-note');
    n.textContent = `Rendimento líquido ao ano para resgate ${NOME_PRAZO[prazo]}, já descontados 0,20% de custódia do Tesouro (exceto no Tesouro Selic). A tendência usa o CDI e o IPCA esperados pelo Focus. CDB e LCI/LCA usam percentuais de referência: compare com a oferta real na calculadora abaixo.`;
  }

  function fiis() {
    const d = dash.data('sug_fii'), tb = document.querySelector('#sg-fii tbody'), fora = document.getElementById('sg-fii-fora');
    if (d.status !== 'ok') { failed(tb, d); fora.textContent = ''; return; }
    const seg = dash.params().seg_sug || '';
    const validos = d.data.filter((f) => !f.inconsistente);
    const segs = [...new Set(validos.map((f) => f.segmento))].sort();
    if (segSel !== document.activeElement) { segSel.replaceChildren(new Option('Todos os segmentos', ''), ...segs.map((x) => new Option(x, x))); segSel.value = seg; }
    const rows = validos.filter((f) => !seg || f.segmento === seg).sort((a, b) => {
      const x = a[ordem.k], y = b[ordem.k];
      if (x == null) return 1; if (y == null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return ordem.desc ? -c : c;
    });
    document.querySelectorAll('#sg-fii thead th').forEach((th) => { const b = th.querySelector('button'); th.setAttribute('aria-sort', b && b.dataset.k === ordem.k ? (ordem.desc ? 'descending' : 'ascending') : 'none'); });
    tb.replaceChildren(...rows.map((f) => {
      const tr = el('tr', {});
      const nome = el('td', {});
      nome.append(el('b', {}, f.ticker), el('div', {class: 'sub'}, f.tipo));
      const selos = el('div', {});
      if (f.na_carteira) selos.append(el('span', {class: 'pf-st'}, '• Na sua carteira'));
      if (f.destaque) selos.append(el('span', {class: 'pf-st good'}, '✓ Destaque do segmento'));
      if (f.p_vp > 1.02) selos.append(el('span', {class: 'pf-st warning'}, '! Acima do patrimônio'));
      if (selos.childNodes.length) nome.append(selos);
      const [cls, sg] = seta(f.dy, f.dy_tend);
      tr.append(nome, el('td', {}, f.segmento), el('td', {class: 'n'}, pc(f.dy, 1)), el('td', {class: 'n ' + cls}, sg + pc(f.dy_tend, 1)), el('td', {class: 'iv-muted'}, f.regra),
        el('td', {class: 'n'}, f.p_vp.toLocaleString('pt-BR', {minimumFractionDigits: 2})), el('td', {class: 'n'}, mi(f.volume_rs)),
        el('td', {class: 'n'}, Math.round(f.cotistas / 1000).toLocaleString('pt-BR') + ' mil'));
      return tr;
    }));
    const inc = d.data.filter((f) => f.inconsistente).map((f) => `${f.ticker} (P/VP ${f.p_vp.toLocaleString('pt-BR')})`);
    fora.textContent = inc.length ? `Fora da lista por dado inconsistente entre cotação e valor patrimonial da CVM: ${inc.join(', ')}.` : '';
  }

  function etfs() {
    const d = dash.data('sug_etf'), tb = document.querySelector('#sg-etf tbody');
    if (d.status !== 'ok') { failed(tb, d); return; }
    tb.replaceChildren(...d.data.map((e) => {
      const tr = el('tr', {});
      const faixa = el('td', {});
      if (e.posicao_52s != null) {
        const bar = el('div', {class: 'iv-range', title: `${F.brl2(e.min52)} a ${F.brl2(e.max52)}`});
        bar.append(el('span', {style: `left:${Math.max(0, Math.min(100, e.posicao_52s))}%;background:${dash.colors[0]}`}));
        faixa.append(bar, el('div', {class: 'sub'}, `${e.posicao_52s}% da faixa · ${F.brl(e.min52)} a ${F.brl(e.max52)}`));
      }
      tr.append(el('td', {}, e.ticker), el('td', {class: 'iv-muted'}, e.descricao),
        el('td', {class: 'n ' + (e.retorno_12m >= 0 ? 'iv-pos' : 'iv-neg')}, (e.retorno_12m >= 0 ? '+' : '') + pc(e.retorno_12m, 1)),
        el('td', {class: 'n'}, F.brl2(e.preco)), faixa, el('td', {class: 'n'}, mi(e.volume_rs)), el('td', {class: 'iv-muted'}, 'Sem projeção confiável: acompanha o mercado'));
      return tr;
    }));
  }

  function cenario() {
    const d = dash.data('sug_cenario'), host = document.getElementById('sg-cen');
    if (d.status !== 'ok' || !d.data[0]) { if (d.status === 'error') host.textContent = ''; return; }
    const c = d.data[0];
    const b = (txt, field) => el('b', {'data-source': 'sug_cenario', 'data-field': field, 'data-row': '0'}, txt);
    host.replaceChildren(document.createTextNode('CDI hoje '), b(pc(c.cdi), 'cdi'), document.createTextNode(' → média esperada nos próximos 12 meses '), b(pc(c.cdi12), 'cdi12'),
      document.createTextNode(` (Selic ${pc(c.selic)} hoje, ${pc(c.selic_f0)} no fim de ${c.ano0} e ${pc(c.selic_f1)} no fim de ${c.ano1}, pelo Focus). IPCA de 12 meses `), b(pc(c.ipca), 'ipca'),
      document.createTextNode(' → '), b(pc(c.ipca_f1), 'ipca_f1'), document.createTextNode(` esperado para ${c.ano1}.`));
  }

  dash.onData(() => { cenario(); simulador(); rf(); fiis(); etfs(); });
})();
