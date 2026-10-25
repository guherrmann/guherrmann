// Aba Investimentos: cálculos (dash.calc) e desenho.

dash.calc('juros', {
  inputs: ['cenario', 'focus'],
  title: 'Juros, inflação e expectativas',
  description: 'CDI, Selic e IPCA atuais, juro real dos últimos 12 meses, poupança e medianas do Focus para os próximos anos.',
  fn: (cenario, focus) => {
    const v = (k) => { const r = cenario.find((x) => x.indicador === k); return r ? Number(r.valor) : null; };
    const anos = [...new Set(focus.map((f) => Number(f.ano)))].sort();
    const f = (ind, ano) => { const r = focus.find((x) => x.indicador === ind && Number(x.ano) === ano); return r ? Number(r.mediana) : null; };
    const cdi = v('cdi'), selic = v('selic_meta'), ipca = v('ipca_12m');
    return [{
      cdi, selic, ipca_12m: ipca,
      juro_real: Math.round(((1 + cdi / 100) / (1 + ipca / 100) - 1) * 10000) / 100,
      poupanca: selic > 8.5 ? Math.round((Math.pow(1.005, 12) - 1) * 10000) / 100 : Math.round(selic * 70) / 100,
      ano0: anos[0], ano1: anos[1], ano2: anos[2],
      selic_f0: f('Selic', anos[0]), selic_f1: f('Selic', anos[1]), selic_f2: f('Selic', anos[2]),
      ipca_f0: f('IPCA', anos[0]), ipca_f1: f('IPCA', anos[1]), pib_f0: f('PIB Total', anos[0]),
      data_cdi: (cenario.find((x) => x.indicador === 'cdi') || {}).data,
      data_focus: (focus[0] || {}).data,
    }];
  },
});

dash.calc('rf_opcoes', {
  inputs: ['juros', 'tesouro'],
  title: 'Renda fixa: bruta e líquida por prazo',
  description: 'Rentabilidade anual bruta e líquida de IR (6 meses, 1 ano, 2 anos+) de poupança, CDB e LCI/LCA de referência e títulos do Tesouro de hoje.',
  fn: (juros, tesouro) => {
    const j = juros[0];
    if (!j) return [];
    const IRs = {liq_6m: 0.225, liq_1a: 0.2, liq_2a: 0.15};
    const r2 = (x) => x == null ? null : Math.round(x * 100) / 100;
    const linha = (o) => {
      const out = {...o, bruta: r2(o.bruta)};
      Object.entries(IRs).forEach(([k, ir]) => {
        if (o.min_meses && ((k === 'liq_6m' && o.min_meses > 6) || (k === 'liq_1a' && o.min_meses > 12))) { out[k] = null; out['rel_' + k.slice(4)] = null; return; }
        const liq = (o.isento ? o.bruta : o.bruta * (1 - ir)) - (o.custodia || 0);
        out[k] = r2(liq);
        out['rel_' + k.slice(4)] = Math.round(liq / (j.cdi * (1 - ir)) * 100);
      });
      return out;
    };
    const td = (tipo, anoMin) => tesouro.filter((t) => t.tipo === tipo).sort((a, b) => a.vencimento.localeCompare(b.vencimento)).find((t) => Number(t.vencimento.slice(0, 4)) >= anoMin);
    const ano = Number(String(j.data_cdi || '').slice(0, 4)) || new Date().getFullYear();
    const rows = [
      {opcao: 'Poupança', indexador: '0,5% ao mês + TR', bruta: j.poupanca, isento: true, liquidez: 'Imediata', garantia: 'FGC'},
      {opcao: 'CDB liquidez diária 100% do CDI', indexador: '100% do CDI', bruta: j.cdi, liquidez: 'Imediata', garantia: 'FGC'},
      {opcao: 'CDB 110% do CDI (referência)', indexador: '110% do CDI', bruta: j.cdi * 1.1, liquidez: 'No vencimento', garantia: 'FGC'},
      {opcao: 'LCI/LCA 90% do CDI (referência)', indexador: '90% do CDI, isento', bruta: j.cdi * 0.9, isento: true, min_meses: 9, liquidez: 'Carência de 9 a 12 meses', garantia: 'FGC'},
    ];
    const sel = td('Tesouro Selic', ano + 2);
    if (sel) rows.push({opcao: sel.titulo, indexador: `Selic + ${String(sel.taxa_compra).replace('.', ',')}%`, bruta: j.cdi + Number(sel.taxa_compra), liquidez: 'D+1', garantia: 'Tesouro Nacional'});
    [ano + 3, ano + 6].forEach((a) => {
      const p = td('Tesouro Prefixado', a);
      if (p && !rows.some((r) => r.opcao === p.titulo)) rows.push({opcao: p.titulo, indexador: 'Prefixado', bruta: Number(p.taxa_compra), custodia: 0.2, liquidez: 'D+1, a preço de mercado', garantia: 'Tesouro Nacional'});
    });
    [ano + 3, ano + 9].forEach((a) => {
      const p = td('Tesouro IPCA+', a);
      if (p && !rows.some((r) => r.opcao === p.titulo)) rows.push({opcao: p.titulo, indexador: `IPCA + ${String(p.taxa_compra).replace('.', ',')}%`, bruta: ((1 + Number(p.taxa_compra) / 100) * (1 + (j.ipca_f1 || j.ipca_12m) / 100) - 1) * 100, custodia: 0.2, liquidez: 'D+1, a preço de mercado', garantia: 'Tesouro Nacional'});
    });
    return rows.map(linha);
  },
});

dash.calc('caixa', {
  inputs: ['carteira', 'juros'],
  title: 'Dinheiro em conta',
  description: 'Saldo de cada conta, o que rendeu em 12 meses e quanto renderia a 100% do CDI, líquido de IR de 1 a 2 anos (17,5%).',
  fn: (carteira, juros) => {
    const cdi = juros[0] ? juros[0].cdi : 0;
    return carteira.filter((c) => c.classe === 'Caixa').map((c) => {
      const saldo = Number(c.valor) || 0, rend = Number(c.rend_12m) || 0, potencial = saldo * cdi / 100 * (1 - 0.175);
      return {conta: c.ativo, saldo, rend_12m: rend, potencial, ganho: potencial - rend};
    });
  },
});

dash.calc('reserva', {
  inputs: ['mensal', 'carteira'],
  title: 'Reserva de emergência',
  description: 'Seis vezes a saída média mensal dos últimos 12 meses, comparada ao dinheiro em conta.',
  fn: (mensal, carteira) => {
    const media = mensal.reduce((s, m) => s + (Number(m.despesa) || 0), 0) / (mensal.length || 1);
    const caixa = carteira.filter((c) => c.classe === 'Caixa').reduce((s, c) => s + (Number(c.valor) || 0), 0);
    return [{despesa_media: media, alvo: media * 6, caixa, falta: Math.max(0, media * 6 - caixa)}];
  },
});

dash.calc('fundos_ind', {
  inputs: ['fundos', 'juros'],
  title: 'Indicadores dos FIIs e Fiagros',
  description: 'P/VP (cotação ÷ valor patrimonial da CVM), DY de 12 meses (rendimentos por cota ÷ cotação) e diferença para o CDI líquido de 15% de IR.',
  fn: (fundos, juros) => {
    const cdiLiq = juros[0] ? juros[0].cdi * 0.85 : null;
    return fundos.map((f) => {
      const preco = Number(f.preco) || null, vp = Number(f.vp_cota) || null, rend = f.rend_12m_cota == null ? null : Number(f.rend_12m_cota);
      const dy = preco && rend ? Math.round(rend / preco * 1000) / 10 : null;
      return {ticker: f.ticker, segmento: f.segmento, tipo: f.tipo, preco, vp_cota: vp,
        p_vp: preco && vp ? Math.round(preco / vp * 100) / 100 : null, dy,
        premio: dy != null && cdiLiq != null ? Math.round((dy - cdiLiq) * 10) / 10 : null,
        cotistas: f.cotistas == null ? null : Number(f.cotistas), na_carteira: !!f.na_carteira, cotas: f.cotas, mes_cvm: f.mes_cvm};
    });
  },
});

dash.calc('carteira_ativos', {
  inputs: ['carteira', 'fundos_ind'],
  title: 'Ativos da carteira',
  description: 'Cada fundo e ação da carteira com valor, DY e P/VP.',
  fn: (carteira, fundos_ind) => carteira.filter((c) => c.classe !== 'Caixa').map((c) => {
    const f = fundos_ind.find((x) => x.ticker === c.ativo) || {};
    return {ativo: c.ativo, classe: c.classe, segmento: f.segmento || c.classe, cotas: c.cotas, preco: c.preco, valor: c.valor,
      rend_12m: Number(c.rend_12m) || 0, ultimo_rend: c.ultimo_rend, dy: f.dy ?? null, p_vp: f.p_vp ?? null};
  }).sort((a, b) => (b.valor || 0) - (a.valor || 0)),
});

dash.calc('carteira_classes', {
  inputs: ['carteira'],
  title: 'Carteira por classe',
  description: 'Valor por classe de ativo (caixa, FII, Fiagro, ação) e renda recebida em 12 meses.',
  fn: (carteira) => {
    const tot = carteira.reduce((s, c) => s + (Number(c.valor) || 0), 0);
    const by = {};
    carteira.forEach((c) => { const k = c.classe; by[k] = by[k] || {classe: k, valor: 0, rend_12m: 0}; by[k].valor += Number(c.valor) || 0; by[k].rend_12m += Number(c.rend_12m) || 0; });
    return Object.values(by).map((x) => ({...x, parte: tot ? Math.round(x.valor / tot * 1000) / 10 : 0})).sort((a, b) => b.valor - a.valor);
  },
});

dash.calc('carteira_total', {
  inputs: ['carteira'],
  title: 'Totais da carteira',
  description: 'Patrimônio total, parte em renda variável, renda recebida em 12 meses e no último mês.',
  fn: (carteira) => {
    const soma = (f) => carteira.filter(f).reduce((s, c) => s + (Number(c.valor) || 0), 0);
    const total = soma(() => true), rv = soma((c) => c.classe !== 'Caixa');
    const rend = carteira.reduce((s, c) => s + (Number(c.rend_12m) || 0), 0);
    const meses = carteira.map((c) => c.mes_ultimo).filter(Boolean).sort();
    const ult = meses[meses.length - 1];
    const mes = carteira.filter((c) => c.mes_ultimo === ult).reduce((s, c) => s + (Number(c.ultimo_rend) || 0), 0);
    return [{total, rv, caixa: total - rv, rend_12m: rend, renda_mes: mes, mes_renda: ult || null, yield_rv: rv ? Math.round(mes * 12 / rv * 1000) / 10 : null,
      parte_caixa: total ? Math.round((total - rv) / total * 1000) / 10 : null}];
  },
});

dash.calc('sugestoes_rf', {
  inputs: ['juros', 'caixa', 'reserva', 'tesouro', 'rf_opcoes'],
  title: 'Sugestões de renda fixa',
  description: 'Regras: dinheiro parado em conta, tamanho da reserva, juro real do IPCA+, prefixado contra a Selic esperada pelo Focus e equivalência LCI/LCA × CDB.',
  fn: (juros, caixa, reserva, tesouro, rf_opcoes) => {
    const j = juros[0], r = reserva[0];
    if (!j || !r) return [];
    const brl = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    const pc = (v) => Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 2}) + '%';
    const out = [];
    const parado = caixa.reduce((s, c) => s + c.saldo, 0), rendeu = caixa.reduce((s, c) => s + c.rend_12m, 0), pot = caixa.reduce((s, c) => s + c.potencial, 0);
    if (parado > 500 && rendeu < pot * 0.5) {
      out.push({ordem: 1, nivel: 'alta', titulo: 'Tirar o dinheiro parado da conta corrente',
        texto: `${brl(parado)} em conta renderam ${brl(rendeu)} em 12 meses. A 100% do CDI (${pc(j.cdi)} a.a.), num CDB de liquidez diária com FGC ou no Tesouro Selic, renderiam cerca de ${brl(pot)} por ano já descontado o IR: ${brl(pot - rendeu)} a mais.`});
    }
    out.push({ordem: 2, nivel: r.falta > 0 ? 'alta' : 'ok', titulo: r.falta > 0 ? 'Completar a reserva de emergência' : 'Reserva de emergência completa',
      texto: r.falta > 0
        ? `A reserva ideal é ${brl(r.alvo)} (6 meses da sua saída média de ${brl(r.despesa_media)}). Hoje há ${brl(r.caixa)} em conta: faltam ${brl(r.falta)}. Ela deve ficar em aplicação de liquidez diária (CDB 100% do CDI ou Tesouro Selic), não em FIIs ou prefixados.`
        : `O dinheiro em conta cobre 6 meses de gastos (${brl(r.alvo)}). O que passar disso pode ir para prazos mais longos.`});
    const ipca = tesouro.filter((t) => t.tipo === 'Tesouro IPCA+').sort((a, b) => b.taxa_compra - a.taxa_compra)[0];
    if (ipca) {
      out.push({ordem: 3, nivel: Number(ipca.taxa_compra) >= 6 ? 'media' : 'info', titulo: `${ipca.titulo}: IPCA + ${pc(ipca.taxa_compra)}`,
        texto: `É o maior juro real do Tesouro hoje.${Number(ipca.taxa_compra) >= 6 ? ' Juro real acima de 6% ao ano é raro no histórico do título.' : ''} Garante ganho acima da inflação até o vencimento. O preço oscila se precisar vender antes, então é para dinheiro de longo prazo, depois da reserva.`});
    }
    const pre = tesouro.filter((t) => t.tipo === 'Tesouro Prefixado').sort((a, b) => a.vencimento.localeCompare(b.vencimento)).find((t) => Number(t.vencimento.slice(0, 4)) >= Number(j.ano0) + 2);
    if (pre && j.selic_f1 != null && j.selic_f2 != null) {
      const media = (j.selic + j.selic_f0 + j.selic_f1 + j.selic_f2) / 4;
      out.push({ordem: 4, nivel: 'info', titulo: `${pre.titulo}: ${pc(pre.taxa_compra)} ao ano`,
        texto: `O Focus espera Selic de ${pc(j.selic_f0)} no fim de ${j.ano0}, ${pc(j.selic_f1)} em ${j.ano1} e ${pc(j.selic_f2)} em ${j.ano2} (média de cerca de ${pc(Math.round(media * 100) / 100)} com a taxa atual). ${Number(pre.taxa_compra) > media ? 'Se isso se confirmar, o prefixado rende mais que o CDI no período. Se os juros voltarem a subir, rende menos.' : 'O prefixado paga menos que a média de Selic esperada: o CDI tende a render mais.'}`});
    }
    const lci = rf_opcoes.find((o) => o.opcao.startsWith('LCI'));
    if (lci) {
      const eq = 0.9 / (1 - 0.175) * 100;
      out.push({ordem: 5, nivel: 'info', titulo: 'LCI e LCA: compare pela taxa líquida',
        texto: `Uma LCI/LCA de 90% do CDI equivale a um CDB de ${Math.round(eq)}% do CDI entre 1 e 2 anos (IR de 17,5%). Só vale a pena se você puder deixar o dinheiro pela carência, de 9 a 12 meses. Use a calculadora ao lado com a oferta real.`});
    }
    out.push({ordem: 6, nivel: 'info', titulo: 'CRI e CRA',
      texto: `São isentos de IR, mas não têm FGC: o risco é de quem emitiu. Para valer a pena, o prêmio sobre o Tesouro IPCA+${ipca ? ` (IPCA + ${pc(ipca.taxa_compra)})` : ''} precisa compensar esse risco e a liquidez menor. Hoje você já tem exposição a eles pelos FIIs de papel e Fiagros.`});
    return out;
  },
});

dash.calc('sugestoes_rv', {
  inputs: ['fundos_ind', 'carteira_ativos', 'juros', 'etfs'],
  title: 'Sugestões de renda variável',
  description: 'Regras: concentração por segmento, fundos do mesmo segmento com DY maior e P/VP até 1, posições acima do valor patrimonial, posições pequenas e diversificação com ETFs.',
  fn: (fundos_ind, carteira_ativos, juros, etfs) => {
    const j = juros[0];
    const brl = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    const pc = (v) => Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '%';
    const n2 = (v) => Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const out = [];
    const rv = carteira_ativos.reduce((s, a) => s + (Number(a.valor) || 0), 0);
    const seg = {};
    carteira_ativos.forEach((a) => { seg[a.segmento] = (seg[a.segmento] || 0) + (Number(a.valor) || 0); });
    const papel = (seg['Papel (CRI)'] || 0) + (seg['Fiagro (CRA)'] || 0);
    if (rv && papel / rv > 0.5) {
      out.push({ordem: 1, nivel: 'media', titulo: `${pc(papel / rv * 100)} da renda variável em crédito (CRI e CRA)`,
        texto: `FIIs de papel e Fiagros pagam bem com juros altos, mas os rendimentos caem quando a Selic cai (o Focus espera ${j ? pc(j.selic_f1) : '—'} em ${j ? j.ano1 : ''}), e há risco de calote nos recebíveis. FIIs de tijolo (logística, shoppings) e ETFs equilibram a carteira.`});
    }
    carteira_ativos.filter((a) => a.dy != null).forEach((a) => {
      const meu = fundos_ind.find((f) => f.ticker === a.ativo);
      if (!meu) return;
      const alt = fundos_ind.filter((f) => f.segmento === meu.segmento && !f.na_carteira && f.dy != null && f.p_vp != null && f.p_vp <= 1 && (f.cotistas || 0) >= 50000 && f.dy >= meu.dy + 1)
        .sort((x, y) => y.dy - x.dy)[0];
      if (alt) out.push({ordem: 2, nivel: 'info', titulo: `${a.ativo} × ${alt.ticker} (${meu.segmento})`,
        texto: `${a.ativo}: DY de ${pc(meu.dy)} e P/VP ${n2(meu.p_vp)}. ${alt.ticker}, do mesmo segmento: DY de ${pc(alt.dy)} e P/VP ${n2(alt.p_vp)}, com ${Math.round(alt.cotistas / 1000)} mil cotistas. Antes de trocar, leia o relatório gerencial: DY maior pode refletir mais risco nos recebíveis.`});
      if (meu.p_vp != null && meu.p_vp > 1.02) out.push({ordem: 3, nivel: 'info', titulo: `${a.ativo} negocia acima do patrimônio`,
        texto: `P/VP de ${n2(meu.p_vp)}: cada R$ 1 de patrimônio custa R$ ${n2(meu.p_vp)} na bolsa. Não é motivo para vender, mas pode não ser o melhor momento para aumentar a posição.`});
    });
    const peq = carteira_ativos.filter((a) => a.valor != null && a.valor < 250);
    if (peq.length) out.push({ordem: 4, nivel: 'info', titulo: 'Posições pequenas',
      texto: `${peq.map((a) => a.ativo + ' (' + brl(a.valor) + ')').join(', ')}. Com tão pouco, o efeito na carteira é mínimo. Vale concentrar os próximos aportes em menos fundos.`});
    const temEtf = carteira_ativos.some((a) => a.classe === 'ETF');
    if (!temEtf) {
      const e = (t) => etfs.find((x) => x.ticker === t);
      const b = e('BOVA11'), i = e('IVVB11');
      out.push({ordem: 5, nivel: 'info', titulo: 'Diversificar com ETFs',
        texto: `Sua renda variável não tem índice amplo de ações nem exposição ao exterior.${b ? ` BOVA11 (Ibovespa) custa ${brl(b.preco)} a cota.` : ''}${i ? ` IVVB11 (S&P 500, em dólar) custa ${brl(i.preco)}.` : ''} ETFs têm taxa baixa e diversificam com uma única compra. Rendimentos e ganhos de ETF de ações pagam 15% de IR.`});
    }
    return out;
  },
});

(() => {
  const F = window.pfFmt;
  const pc2 = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '%';
  const pc1 = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '%';
  const num2 = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const el = (tag, attrs, text) => { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); if (text != null) e.textContent = text; return e; };
  const failed = (host, d) => { host.replaceChildren(); if (d.status === 'error') host.innerHTML = '<div class="pf-err">Falhou ao carregar</div>'; };

  // Abas
  const tabs = document.querySelectorAll('.pf-tabs [data-tab]');
  window.pfDraw = window.pfDraw || {};
  const show = (id) => {
    tabs.forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; document.getElementById(b.dataset.tab).hidden = !on; });
    dash.setLink(id);
    Object.values(window.pfDraw).forEach((fn) => fn());
  };
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  const alvo = location.hash.slice(1);
  const secaoInv = alvo && document.getElementById(alvo) && document.getElementById(alvo).closest('#investimentos');
  show(alvo === 'investimentos' || secaoInv ? 'investimentos' : 'orcamento');
  if (secaoInv && alvo !== 'investimentos') document.getElementById(alvo).scrollIntoView();

  const visivel = () => !document.getElementById('investimentos').hidden;

  // Controles
  document.getElementById('iv-prazo').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (b) dash.setParams({prazo: b.dataset.p}); });
  document.getElementById('iv-td-tipo').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) dash.setParams({td_tipo: b.dataset.t}); });
  const segSel = document.getElementById('iv-seg');
  segSel.addEventListener('change', () => dash.setParams({segmento: segSel.value || null}));
  let ordem = {k: 'dy', desc: true};
  document.querySelector('#iv-fundos thead').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    ordem = {k: b.dataset.k, desc: ordem.k === b.dataset.k ? !ordem.desc : !['ticker', 'segmento', 'p_vp'].includes(b.dataset.k)};
    desenharFundos();
  });
  ['iv-calc-lci', 'iv-calc-prazo'].forEach((id) => document.getElementById(id).addEventListener('input', calcular));

  function calcular() {
    const out = document.getElementById('iv-calc-out'), j = dash.data('juros');
    const lci = Number(document.getElementById('iv-calc-lci').value), ir = Number(document.getElementById('iv-calc-prazo').value);
    if (j.status !== 'ok' || !j.data[0] || !lci) { out.textContent = ''; return; }
    const cdi = j.data[0].cdi, eq = lci / (1 - ir);
    out.replaceChildren(document.createTextNode(`Um CDB precisa pagar `), el('b', {}, `${Math.round(eq * 10) / 10}% do CDI`),
      document.createTextNode(` (${pc2(cdi * eq / 100)} ao ano, com o CDI de `), el('b', {'data-source': 'juros', 'data-field': 'cdi', 'data-row': '0'}, pc2(cdi)),
      document.createTextNode(`) para empatar com a LCI/LCA de ${lci}% do CDI, que rende ${pc2(cdi * lci / 100)} isento.`));
  }

  function kpi(host, items) {
    host.replaceChildren(...items.map((it) => {
      const c = el('div', {class: 'pf-card pf-kpi', id: it.id});
      c.append(el('div', {class: 'l'}, it.l));
      const v = el('div', {class: 'v', 'data-source': it.src, 'data-field': it.field, 'data-row': '0'}, it.v);
      c.append(v, el('div', {class: 'd'}, it.d || ''));
      if (it.st) { const s = el('div', {class: 'pf-st ' + it.st[0]}, it.st[1]); c.append(s); }
      return c;
    }));
  }

  function desenharFundos() {
    const d = dash.data('fundos_ind'), tb = document.querySelector('#iv-fundos tbody');
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    const seg = dash.params().segmento || '';
    const segs = [...new Set(d.data.map((f) => f.segmento).filter(Boolean))].sort();
    if (segSel !== document.activeElement) {
      segSel.replaceChildren(new Option('Todos os segmentos', ''), ...segs.map((s) => new Option(s, s)));
      segSel.value = seg;
    }
    const rows = d.data.filter((f) => !seg || f.segmento === seg).slice().sort((a, b) => {
      const x = a[ordem.k], y = b[ordem.k];
      if (x == null) return 1; if (y == null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return ordem.desc ? -c : c;
    });
    document.querySelectorAll('#iv-fundos thead th').forEach((th) => { const b = th.querySelector('button'); th.setAttribute('aria-sort', b && b.dataset.k === ordem.k ? (ordem.desc ? 'descending' : 'ascending') : 'none'); });
    tb.replaceChildren(...rows.map((f) => {
      const tr = el('tr', {});
      if (f.na_carteira) tr.className = 'iv-mine';
      const tk = el('td', {}, f.ticker);
      tr.append(tk, el('td', {}, f.segmento), el('td', {class: 'n'}, f.preco == null ? '—' : F.brl2(f.preco)), el('td', {class: 'n'}, pc1(f.dy)),
        el('td', {class: 'n ' + (f.premio == null ? '' : f.premio >= 0 ? 'iv-pos' : 'iv-neg')}, f.premio == null ? '—' : (f.premio > 0 ? '+' : '') + pc1(f.premio)),
        el('td', {class: 'n'}, num2(f.p_vp)), el('td', {class: 'n'}, f.cotistas == null ? '—' : Math.round(f.cotistas).toLocaleString('pt-BR')));
      return tr;
    }));
  }

  function sugestoes(id, ds) {
    const host = document.getElementById(id), d = dash.data(ds);
    if (d.status !== 'ok') { failed(host, d); return; }
    const ic = {alta: ['!', 'iv-alta'], media: ['!', 'iv-media'], ok: ['✓', 'iv-ok'], info: ['i', 'iv-info']};
    host.replaceChildren(...d.data.slice().sort((a, b) => a.ordem - b.ordem).map((s) => {
      const item = el('div', {class: 'iv-item'});
      const [g, cls] = ic[s.nivel] || ic.info;
      item.append(el('span', {class: 'iv-ic ' + cls, 'aria-hidden': 'true'}, g));
      const body = el('div', {});
      body.append(el('b', {}, s.titulo), el('p', {}, s.texto));
      item.append(body);
      return item;
    }));
  }

  function graficoJuros() {
    const host = document.getElementById('iv-ch-juros'), d = dash.data('cenario_hist');
    if (!visivel()) return;
    if (d.status !== 'ok') { failed(host, d); return; }
    const rows = d.data.filter((r) => r.cdi != null && r.ipca_12m != null);
    if (!rows.length) { host.replaceChildren(); return; }
    const W = Math.max(280, host.clientWidth), H = 230, T = 14, B = 24;
    host.innerHTML = '';
    const svg = d3.select(host).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.cdi, r.ipca_12m)) * 1.1], [H - B, T]).nice(4);
    const fmt = (v) => v + '%';
    const L = 8 + d3.max(y.ticks(4), (v) => fmt(v).length) * 6.5, R = 64;
    const x = d3.scalePoint(rows.map((r) => r.mes), [L, W - R]);
    y.ticks(4).forEach((v) => {
      svg.append('line').attr('x1', L).attr('x2', W - R).attr('y1', y(v)).attr('y2', y(v)).attr('stroke', v === 0 ? 'var(--cds-chart-axis)' : 'var(--cds-chart-grid)');
      svg.append('text').attr('x', L - 6).attr('y', y(v) + 4).attr('text-anchor', 'end').text(fmt(v));
    });
    const every = W < 520 ? 6 : 3;
    rows.forEach((r, i) => { if ((rows.length - 1 - i) % every === 0) svg.append('text').attr('x', x(r.mes)).attr('y', H - 6).attr('text-anchor', 'middle').text(F.mes(r.mes)); });
    [['cdi', 0, 'CDI'], ['ipca_12m', 1, 'IPCA']].forEach(([k, c, nome]) => {
      svg.append('path').attr('d', d3.line().x((r) => x(r.mes)).y((r) => y(r[k]))(rows)).attr('fill', 'none').attr('stroke', dash.colors[c]).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
      const u = rows[rows.length - 1];
      svg.append('circle').attr('cx', x(u.mes)).attr('cy', y(u[k])).attr('r', 4).attr('fill', dash.colors[c]).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2);
      svg.append('text').attr('x', x(u.mes) + 8).attr('y', y(u[k]) + 4).text(`${nome} ${pc2(u[k])}`);
    });
    const rule = svg.append('line').attr('y1', T).attr('y2', H - B).attr('stroke', 'var(--cds-chart-axis)').attr('opacity', 0);
    let tip = host.querySelector('.pf-tip'); if (!tip) { tip = el('div', {class: 'pf-tip'}); host.appendChild(tip); }
    svg.append('rect').attr('x', L).attr('y', T).attr('width', W - R - L).attr('height', H - T - B).attr('fill', 'transparent')
      .on('mousemove', (ev) => {
        const [mx] = d3.pointer(ev);
        const i = Math.max(0, Math.min(rows.length - 1, Math.round((mx - L) / ((W - R - L) / (rows.length - 1 || 1)))));
        const r = rows[i];
        rule.attr('x1', x(r.mes)).attr('x2', x(r.mes)).attr('opacity', 1);
        tip.innerHTML = `<div class="t">${F.mes(r.mes)}</div><div class="r"><span><i style="background:${dash.colors[0]}"></i>CDI</span><span>${pc2(r.cdi)}</span></div><div class="r"><span><i style="background:${dash.colors[1]}"></i>IPCA 12m</span><span>${pc2(r.ipca_12m)}</span></div><div class="r"><span>Juro real</span><span>${pc2(((1 + r.cdi / 100) / (1 + r.ipca_12m / 100) - 1) * 100)}</span></div>`;
        tip.style.opacity = 1;
        const b = host.getBoundingClientRect();
        tip.style.left = Math.max(0, Math.min(ev.clientX - b.left + 12, b.width - tip.offsetWidth)) + 'px';
        tip.style.top = Math.max(0, Math.min(ev.clientY - b.top + 12, b.height - tip.offsetHeight)) + 'px';
      })
      .on('mouseleave', () => { tip.style.opacity = 0; rule.attr('opacity', 0); });
  }
  window.pfDraw.juros = graficoJuros;

  dash.onData(() => {
    const p = dash.params(), prazo = p.prazo || '1a', tdTipo = p.td_tipo || 'IPCA';
    document.querySelectorAll('#iv-prazo button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === prazo)));
    document.querySelectorAll('#iv-td-tipo button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === tdTipo)));

    // Cenário
    const j = dash.data('juros'), jr = j.status === 'ok' ? j.data[0] : null;
    const cen = document.getElementById('iv-cen');
    if (jr) {
      document.getElementById('iv-cen-note').textContent = `Banco Central (SGS), CDI de ${new Date(jr.data_cdi + 'T12:00').toLocaleDateString('pt-BR')}, e Boletim Focus de ${new Date(jr.data_focus + 'T12:00').toLocaleDateString('pt-BR')}`;
      kpi(cen, [
        {l: 'Selic (meta)', v: pc2(jr.selic), src: 'juros', field: 'selic', d: `Focus: ${pc2(jr.selic_f0)} no fim de ${jr.ano0}`},
        {l: 'CDI', v: pc2(jr.cdi), src: 'juros', field: 'cdi', d: 'ao ano, referência da renda fixa'},
        {l: 'IPCA 12 meses', v: pc2(jr.ipca_12m), src: 'juros', field: 'ipca_12m', d: `Focus: ${pc2(jr.ipca_f0)} em ${jr.ano0}, ${pc2(jr.ipca_f1)} em ${jr.ano1}`},
        {l: 'Juro real (12 meses)', v: pc2(jr.juro_real), src: 'juros', field: 'juro_real', d: 'CDI descontada a inflação'},
        {l: `Selic esperada para ${jr.ano1}`, v: pc2(jr.selic_f1), src: 'juros', field: 'selic_f1', d: `e ${pc2(jr.selic_f2)} em ${jr.ano2}: juros em queda`},
        {l: 'Poupança', v: pc2(jr.poupanca), src: 'juros', field: 'poupanca', d: 'ao ano + TR, isenta'},
      ]);
    } else { failed(cen, j); }
    graficoJuros();

    // Carteira
    const t = dash.data('carteira_total'), tr = t.status === 'ok' ? t.data[0] : null, ck = document.getElementById('iv-cart-kpis');
    if (tr) {
      kpi(ck, [
        {l: 'Patrimônio mapeado', v: F.brl(tr.total), src: 'carteira_total', field: 'total', d: `${F.brl(tr.rv)} em renda variável`},
        {l: 'Parado em conta corrente', v: pc1(tr.parte_caixa), src: 'carteira_total', field: 'parte_caixa', d: `${F.brl(tr.caixa)} quase sem render`, st: tr.parte_caixa > 50 ? ['critical', '✕ Rendendo abaixo do CDI'] : null},
        {l: 'Renda passiva no último mês', v: F.brl2(tr.renda_mes), src: 'carteira_total', field: 'renda_mes', d: tr.mes_renda ? `${F.mesLongo(tr.mes_renda)} · ${F.brl(tr.rend_12m)} em 12 meses` : ''},
        {l: 'Yield da renda variável', v: pc1(tr.yield_rv), src: 'carteira_total', field: 'yield_rv', d: 'último mês × 12 ÷ valor, isento'},
      ]);
    } else { failed(ck, t); }
    const cl = dash.data('carteira_classes'), clh = document.getElementById('iv-classes');
    if (cl.status === 'ok') {
      const cores = {Caixa: 'var(--cds-chart-muted)'};
      clh.replaceChildren(...cl.data.map((c, i) => {
        const d = el('div', {style: 'margin-bottom:var(--cds-gap-sm)'});
        const top = el('div', {style: 'display:flex;justify-content:space-between;gap:8px'});
        top.append(el('b', {}, c.classe), el('span', {class: 'pf-note', style: 'margin:0'}, `${F.brl(c.valor)} · ${pc1(c.parte)}`));
        const m = el('div', {class: 'pf-meter'});
        m.append(el('div', {class: 'f', style: `width:${c.parte}%;background:${cores[c.classe] || dash.colors[i % 8]}`}));
        d.append(top, m, el('div', {class: 'pf-note', style: 'margin:0'}, `Recebido em 12 meses: ${F.brl2(c.rend_12m)}`));
        return d;
      }));
    } else { failed(clh, cl); }
    const ca = dash.data('carteira_ativos'), cab = document.querySelector('#iv-ativos tbody');
    cab.replaceChildren(...(ca.status === 'ok' ? ca.data : []).map((a) => {
      const row = el('tr', {});
      row.append(el('td', {}, a.ativo), el('td', {class: 'n'}, a.cotas == null ? '—' : String(a.cotas)), el('td', {class: 'n'}, a.valor == null ? '—' : F.brl(a.valor)),
        el('td', {class: 'n'}, pc1(a.dy)), el('td', {class: 'n'}, num2(a.p_vp)), el('td', {class: 'n'}, F.brl2(a.rend_12m)));
      return row;
    }));

    // Renda fixa
    sugestoes('iv-sug-rf', 'sugestoes_rf');
    const rf = dash.data('rf_opcoes'), rfb = document.querySelector('#iv-rf tbody'), k = 'liq_' + prazo;
    const th = document.getElementById('iv-rf-liq-th');
    th.setAttribute('data-field', k);
    th.textContent = {'6m': 'Líquida (até 6 meses)', '1a': 'Líquida (1 ano)', '2a': 'Líquida (2 anos+)'}[prazo];
    const best = rf.status === 'ok' ? d3.max(rf.data, (o) => o[k]) : null;
    rfb.replaceChildren(...(rf.status === 'ok' ? rf.data : []).map((o) => {
      const row = el('tr', {});
      const rel = o['rel_' + prazo];
      row.append(el('td', {}, o.opcao), el('td', {class: 'iv-muted'}, o.indexador), el('td', {class: 'n'}, pc2(o.bruta)),
        el('td', {class: 'n' + (o[k] != null && o[k] === best ? ' iv-best' : '')}, o[k] == null ? 'não disponível' : pc2(o[k])),
        el('td', {class: 'n ' + (rel == null ? '' : rel >= 100 ? 'iv-pos' : 'iv-neg')}, rel == null ? '—' : rel + '%'),
        el('td', {class: 'iv-muted'}, o.liquidez), el('td', {class: 'iv-muted'}, o.garantia));
      return row;
    }));
    calcular();
    const td = dash.data('tesouro'), tdb = document.querySelector('#iv-td tbody');
    const tipos = {Selic: ['Tesouro Selic'], Prefixado: ['Tesouro Prefixado', 'Tesouro Prefixado com Juros Semestrais'], IPCA: ['Tesouro IPCA+', 'Tesouro IPCA+ com Juros Semestrais', 'Tesouro Renda+ Aposentadoria Extra', 'Tesouro Educa+']};
    if (td.status === 'ok' && td.data[0]) document.getElementById('iv-td-note').textContent = `Taxas de compra em ${new Date(td.data[0].data_base + 'T12:00').toLocaleDateString('pt-BR')} (${td.data[0].fonte}). Selic: taxa acima da Selic. IPCA+: juro acima da inflação.`;
    tdb.replaceChildren(...(td.status === 'ok' ? td.data : []).filter((x) => tipos[tdTipo].includes(x.tipo)).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.vencimento.localeCompare(b.vencimento)).map((x) => {
      const row = el('tr', {});
      row.append(el('td', {}, x.titulo), el('td', {class: 'n'}, (tdTipo === 'Selic' ? '+' : '') + pc2(x.taxa_compra)), el('td', {class: 'n'}, F.brl2(x.preco_compra)));
      return row;
    }));

    // Renda variável
    sugestoes('iv-sug-rv', 'sugestoes_rv');
    desenharFundos();
    const et = dash.data('etfs'), etb = document.querySelector('#iv-etfs tbody');
    etb.replaceChildren(...(et.status === 'ok' ? et.data : []).map((e) => {
      const row = el('tr', {});
      const pos = e.max52 > e.min52 ? (e.preco - e.min52) / (e.max52 - e.min52) * 100 : null;
      const faixa = el('td', {});
      if (pos != null) {
        const bar = el('div', {class: 'iv-range', title: `${F.brl2(e.min52)} a ${F.brl2(e.max52)}`});
        bar.append(el('span', {style: `left:${Math.max(0, Math.min(100, pos))}%;background:${dash.colors[0]}`}));
        faixa.append(bar, el('div', {class: 'pf-note', style: 'margin:2px 0 0'}, `${F.brl(e.min52)} – ${F.brl(e.max52)}`));
      }
      row.append(el('td', {}, e.ticker), el('td', {class: 'iv-muted'}, e.descricao), el('td', {class: 'n'}, e.preco == null ? '—' : F.brl2(e.preco)), faixa);
      return row;
    }));

    // Resumo
    const take = document.getElementById('iv-take'), rs = dash.data('reserva');
    if (jr && tr && rs.status === 'ok') {
      const c = dash.data('caixa'), ganho = c.status === 'ok' ? c.data.reduce((s, x) => s + x.ganho, 0) : 0;
      const b1 = el('b', {'data-source': 'carteira_total', 'data-field': 'parte_caixa', 'data-row': '0'}, pc1(tr.parte_caixa));
      const b2 = el('b', {}, F.brl(ganho));
      const b3 = el('b', {'data-source': 'juros', 'data-field': 'juro_real', 'data-row': '0'}, pc2(jr.juro_real));
      take.replaceChildren(document.createTextNode('O juro real está em '), b3, document.createTextNode(' ao ano: a renda fixa paga bem acima da inflação. '), b1,
        document.createTextNode(' do seu patrimônio está parado em conta corrente: aplicado a 100% do CDI, renderia cerca de '), b2,
        document.createTextNode(' a mais por ano.'));
    } else if (j.status === 'error') { take.textContent = ''; }
  });
})();
