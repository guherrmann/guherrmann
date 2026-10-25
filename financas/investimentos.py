"""Monta os conjuntos de dados da aba Investimentos.

A carteira de renda variável é deduzida dos rendimentos que caem na corretora
("RENDIMENTOS DE CLIENTES MXRF11 S/ 45" = 45 cotas de MXRF11). Quantidades de
ativos que não aparecem assim podem ser informadas em financas/dados/carteira_manual.json:
    {"ITSA4": 100, "AXIA3": 10}
Se existir financas/dados/b3_posicao.json (gerado por b3.py), a posição da B3 prevalece
e traz custo, proventos desde a compra, comparação com o CDI e títulos do Tesouro.
"""
import collections
import datetime as dt
import json
import pathlib
import re

import mercado

PADRAO = re.compile(r"(RENDIMENTOS|DIVIDENDOS|JUROS S/ CAPITAL) DE CLIENTES\s+([A-Z]{4}\d{1,2})\s*S/\s*(\d+)?")
RENDA_CAIXA = {"Investimento automático", "Juros de rendimentos de dividendos", "Investimentos"}


def carteira_pierre(transacoes, hoje, manual=None):
    """{ticker: {cotas, rend_12m, ultimo_rend, mes_ultimo}} a partir dos rendimentos recebidos."""
    inicio = (hoje - dt.timedelta(days=365)).isoformat()
    ativos = {}
    caixa_rend = collections.defaultdict(float)
    for t in sorted(transacoes, key=lambda x: x["date"]):
        if t["account_type"] != "BANK" or t["amount"] <= 0:
            continue
        m = PADRAO.search(t.get("description", "").upper())
        if m:
            tk = m.group(2)
            a = ativos.setdefault(tk, {"cotas": None, "rend_12m": 0.0, "ultimo_rend": 0.0, "mes_ultimo": None})
            if m.group(3):
                a["cotas"] = int(m.group(3))
            if t["date"][:10] >= inicio:
                a["rend_12m"] += t["amount"]
            a["ultimo_rend"], a["mes_ultimo"] = t["amount"], t["date"][:7]
        elif (t.get("category") in RENDA_CAIXA) and t["date"][:10] >= inicio:
            caixa_rend[t.get("account_name") or t.get("connector_name")] += t["amount"]
    for tk, q in (manual or {}).items():
        ativos.setdefault(tk, {"cotas": None, "rend_12m": 0.0, "ultimo_rend": 0.0, "mes_ultimo": None})["cotas"] = q
    return ativos, caixa_rend


def classe_de(ticker, info_cvm):
    if ticker in mercado.ETFS:
        return "ETF"
    if info_cvm:
        return info_cvm["tipo"]
    return "FII" if ticker.endswith("11") else "Ação"


def montar(transacoes, saldo, hoje, pasta_dados):
    manual_p = pathlib.Path(pasta_dados) / "carteira_manual.json"
    manual = json.loads(manual_p.read_text()) if manual_p.exists() else {}
    ativos, caixa_rend = carteira_pierre(transacoes, hoje, manual)

    print("Baixando dados de mercado...", file=__import__("sys").stderr)
    atual, hist, foc, _ = mercado.cenario(hoje)
    tesouro = mercado.tesouro(cache=pathlib.Path(pasta_dados) / "tesouro_cache.json")
    cvm = mercado.informes_cvm(hoje)
    fundos_t = sorted(set(mercado.FIIS_CANDIDATOS) | {t for t in ativos if t.endswith("11") and t not in mercado.ETFS})
    acoes_t = sorted(t for t in ativos if not t.endswith("11"))
    cot = mercado.cotacoes(fundos_t + acoes_t + list(mercado.ETFS))

    rotulo = {"selic_meta": "Selic (meta)", "cdi": "CDI", "selic_efetiva": "Selic efetiva", "ipca_12m": "IPCA 12 meses",
              "ipca_mes": "IPCA do mês", "igpm_mes": "IGP-M do mês"}
    cenario = [{"indicador": k, "nome": rotulo[k], "valor": v, "data": d.isoformat(), "fonte": "Banco Central (SGS)"}
               for k, (d, v) in atual.items()]
    meses = sorted(set(hist["cdi"]) | set(hist["selic_meta"]) | set(hist["ipca_12m"]))
    cenario_hist = [{"mes": m, "cdi": hist["cdi"].get(m), "selic": hist["selic_meta"].get(m), "ipca_12m": hist["ipca_12m"].get(m)}
                    for m in meses]
    focus = [{"indicador": x["Indicador"], "ano": int(x["DataReferencia"]), "mediana": x["Mediana"], "data": x["Data"]}
             for x in foc if int(x["DataReferencia"]) <= hoje.year + 2]

    fundos = []
    for t in fundos_t:
        info = cvm.get(t[:4])
        res = mercado.resumo_fundo(info) if info else None
        c = cot.get(t, {})
        fundos.append({
            "ticker": t, "tipo": res["tipo"] if res else "FII",
            "segmento": mercado.SEGMENTOS.get(t) or (res or {}).get("segmento") or "",
            "nome": (res or {}).get("nome") or c.get("nome") or "", "preco": c.get("preco"),
            "vp_cota": res and res["vp_cota"], "rend_12m_cota": res and res["rend_12m_cota"],
            "mes_cvm": res and res["mes_ref"], "pl": res and res["pl"], "cotistas": res and res["cotistas"],
            "volume": c.get("volume"), "na_carteira": t in ativos, "cotas": (ativos.get(t) or {}).get("cotas"),
        })

    etfs = [{"ticker": t, "descricao": d, "preco": cot.get(t, {}).get("preco"), "min52": cot.get(t, {}).get("min52"),
             "max52": cot.get(t, {}).get("max52"), "volume": cot.get(t, {}).get("volume")} for t, d in mercado.ETFS.items()]

    b3_p = pathlib.Path(pasta_dados) / "b3_posicao.json"
    b3_doc = json.loads(b3_p.read_text()) if b3_p.exists() else {}
    b3 = b3_doc.get("ativos", {})
    for t, p in b3.items():  # a posição da B3 prevalece sobre a deduzida dos rendimentos
        if not t.startswith("Tesouro"):
            ativos.setdefault(t, {"cotas": None, "rend_12m": 0.0, "ultimo_rend": 0.0, "mes_ultimo": None})["cotas"] = p["cotas"]

    carteira = []
    for t, p in sorted(b3.items()):
        if t.startswith("Tesouro"):
            titulo = next((x for x in tesouro if x["titulo"] == t), None)
            carteira.append({"ativo": t, "classe": "Tesouro", "cotas": p["cotas"], "preco": titulo and titulo["preco_compra"],
                             "valor": round(p["cotas"] * titulo["preco_compra"], 2) if titulo else None,
                             "rend_12m": 0.0, "ultimo_rend": None, "mes_ultimo": None,
                             "custo": None, "proventos": None, "desde": None, "valor_cdi": None})
    for t, a in sorted(ativos.items()):
        info = cvm.get(t[:4])
        preco = cot.get(t, {}).get("preco")
        carteira.append({"ativo": t, "classe": classe_de(t, info and mercado.resumo_fundo(info)), "cotas": a["cotas"], "preco": preco,
                         "valor": round(a["cotas"] * preco, 2) if a["cotas"] and preco else None,
                         "rend_12m": round(a["rend_12m"], 2), "ultimo_rend": a["ultimo_rend"], "mes_ultimo": a["mes_ultimo"],
                         **{k: (b3.get(t) or {}).get(k) for k in ("custo", "proventos", "desde", "valor_cdi")}})
    for c in saldo.get("accounts", []):
        if c.get("balance"):
            carteira.append({"ativo": f"Conta {c['name']}", "classe": "Caixa", "cotas": None, "preco": None,
                             "valor": c["balance"], "rend_12m": round(_rend_conta(c["name"], caixa_rend), 2),
                             "ultimo_rend": None, "mes_ultimo": None,
                             "custo": None, "proventos": None, "desde": None, "valor_cdi": None})

    carteira_hist = [x for x in b3_doc.get("mensal", []) if x["mes"] >= (meses[0] if meses else "")]
    return {"carteira_hist": carteira_hist, "cenario": cenario, "cenario_hist": cenario_hist, "focus": focus, "tesouro": tesouro,
            "fundos": fundos, "etfs": etfs, "carteira": carteira}


def _rend_conta(nome, caixa_rend):
    nome = nome.upper()
    return sum(v for k, v in caixa_rend.items() if k and (k.upper() in nome or nome in k.upper()
               or ("SANTANDER" in nome and "SANTANDER" in k.upper())))
