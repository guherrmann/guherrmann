"""Plano de aportes: previsto × realizado mês a mês.

O previsto fica em financas/dados/plano.json (fora do Git), no formato:
    {"inicio": "2026-11", "aporte_inicial": 8310, "fica_na_conta": 5000,
     "metas_mensais": {"Restaurante e delivery": 500, ...},
     "meses": [{"mes": "2026-11", "renda": 13266, "gasto": 7450, "aporte": 5800,
                "destino": "...", "saldo": 14218}, ...]}
O realizado vem das transações do Pierre: renda, gasto, sobra (renda − gasto) e o gasto
nas categorias com meta de corte.
"""
import collections
import json
import pathlib

import indicadores

CATEGORIAS_META = {
    "Restaurante e delivery": {"Restaurantes, bares e lanchonetes", "Delivery de alimentos"},
    "Supermercado": {"Supermercado"},
    "Compras": set(indicadores.GRUPOS["Compras"]),  # compras, online, vestuário, eletrônicos...
    "Pedágio e estacionamento": {"Pedágios e pagamentos no veículo", "Estacionamentos"},
}


def carregar(pasta_dados):
    arq = pathlib.Path(pasta_dados) / "plano.json"
    return json.loads(arq.read_text()) if arq.exists() else None


def montar(plano, transacoes, saldo, hoje):
    """Linhas do conjunto `plano` (uma por mês) e `plano_metas` (uma por mês e categoria)."""
    meses = [m["mes"] for m in plano["meses"]]
    atual = hoje.strftime("%Y-%m")
    y, mm = map(int, plano["inicio"].split("-"))
    antes = [f"{y - 1 + (mm - 1 + k) // 12}-{(mm - 1 + k) % 12 + 1:02d}" for k in range(12)]  # 12 meses antes do plano
    gasto_antes = collections.defaultdict(float)
    renda, gasto = collections.defaultdict(float), collections.defaultdict(float)
    por_meta = collections.defaultdict(lambda: collections.defaultdict(float))
    for t in transacoes:
        m = indicadores.mes_da_transacao(t)
        if m in antes:
            tipo, v = indicadores.classificar(t)
            if tipo == "despesa":
                for meta, cats in CATEGORIAS_META.items():
                    if (t.get("category") or "") in cats:
                        gasto_antes[meta] += v
            continue
        if m not in meses:
            continue
        tipo, v = indicadores.classificar(t)
        if tipo == "receita":
            renda[m] += v
        elif tipo == "despesa":
            gasto[m] += v
            cat = t.get("category") or ""
            for meta, cats in CATEGORIAS_META.items():
                if cat in cats:
                    por_meta[meta][m] += v

    linhas, acum_prev, acum_real = [], plano.get("aporte_inicial", 0), plano.get("aporte_inicial", 0)
    for p in plano["meses"]:
        m = p["mes"]
        situacao = "fechado" if m < atual else "em andamento" if m == atual else "futuro"
        acum_prev += p["aporte"]
        real = situacao != "futuro"
        sobra = renda[m] - gasto[m] if real else None
        if real:
            acum_real += sobra
        linhas.append({
            "mes": m, "situacao": situacao, "destino": p.get("destino", ""),
            "renda_prev": p["renda"], "gasto_prev": p["gasto"], "aporte_prev": p["aporte"], "saldo_prev": p.get("saldo"),
            "acumulado_prev": round(acum_prev, 2),
            "renda_real": round(renda[m], 2) if real else None, "gasto_real": round(gasto[m], 2) if real else None,
            "sobra_real": round(sobra, 2) if real else None, "acumulado_real": round(acum_real, 2) if real else None,
        })

    metas = []
    for meta, limite in plano.get("metas_mensais", {}).items():
        for p in plano["meses"]:
            m = p["mes"]
            if m > atual:
                continue
            metas.append({"mes": m, "categoria": meta, "meta": limite, "real": round(por_meta[meta][m], 2),
                          "media_antes": round(gasto_antes[meta] / 12, 2),
                          "situacao": "fechado" if m < atual else "em andamento"})

    contas = {c["name"]: c["balance"] for c in saldo.get("accounts", []) if c.get("balance")}
    santander = sum(v for k, v in contas.items() if "SANTANDER" in k.upper())
    outras = sum(v for k, v in contas.items() if "SANTANDER" not in k.upper())
    resumo = [{"inicio": plano["inicio"], "aporte_inicial": plano.get("aporte_inicial", 0), "fica_na_conta": plano.get("fica_na_conta", 0),
               "parado_em_conta": round(max(0, santander - plano.get("fica_na_conta", 0)) + outras, 2), "hoje": hoje.isoformat()}]
    return {"plano": linhas, "plano_metas": metas, "plano_resumo": resumo}
