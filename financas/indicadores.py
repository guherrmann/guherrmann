"""Classificação de transações e cálculo dos indicadores financeiros.

Convenções do Pierre/Open Finance:
- Conta (BANK): débito tem valor negativo, crédito positivo.
- Cartão (CREDIT): compra tem valor positivo, estorno/pagamento negativo.
"""
import collections
import datetime as dt
import re
import statistics

# Movimentos entre contas próprias ou investimentos: não são receita nem despesa.
INTERNAS = {
    "Pagamento de cartão de crédito", "Transferência mesma titularidade",
    "Investimentos", "Investimento automático", "Fundos multimercado",
}
APLICACOES = {"Investimentos", "Investimento automático", "Fundos multimercado"}
# Destinos que, mesmo categorizados como investimento, são pagamento de fatura.
DESTINOS_FATURA = ("ITAU UNIBANCO", "NU PAGAMENTOS")

GRUPOS = {
    "Carro e transporte": [
        "Postos de gasolina", "Carro", "Manutenção de veículos", "Pedágios e pagamentos no veículo",
        "Estacionamentos", "Seguros", "Seguro de veículos", "Taxas e impostos sobre veículos",
        "Multas de trânsito", "Serviços automotivos", "Táxi e transporte privado urbano",
    ],
    "Alimentação": ["Supermercado", "Restaurantes, bares e lanchonetes", "Delivery de alimentos", "Alimentos e bebidas"],
    "Casa e contas": ["Moradia", "Eletricidade", "Internet", "Celular", "Telecomunicação", "Utensílios para casa"],
    "Saúde e cuidados": [
        "Farmácia", "Saúde", "Dentista", "Hospitais, clínicas e laboratórios", "Saúde e bem-estar",
        "Cabeleireiro", "Academia e centros de lazer", "Artigos esportivos",
    ],
    "Pets": ["Pet Shops e veterinários"],
    "Compras": ["Compras", "Compras online", "Vestuário", "Eletrônicos", "Artigos infantis", "Livraria"],
    "Assinaturas e serviços": [
        "Serviços digitais", "Streaming de vídeo", "Serviços", "Programas de milhagem", "Educação",
        "Universidade", "Atividades de empreendedorismo", "Finanças",
    ],
    "Tarifas, juros e IOF": [
        "Taxas bancárias", "Taxas de cartão de crédito", "Atraso no pagamento e custos de cheque especial",
        "Impostos sobre operações financeiras", "Juros cobrados",
    ],
    "PIX a terceiros": ["Transferência - PIX", "Transferências"],
}
GRUPO_DE = {c: g for g, cats in GRUPOS.items() for c in cats}

# Gastos fixos: contas que se repetem todo mês com valor parecido.
FIXOS = {
    "Moradia", "Eletricidade", "Internet", "Celular", "Telecomunicação", "Seguros", "Seguro de veículos",
    "Streaming de vídeo", "Serviços digitais", "Taxas de cartão de crédito", "Academia e centros de lazer",
    "Educação", "Universidade",
}
COMER_FORA = {"Restaurantes, bares e lanchonetes", "Delivery de alimentos"}
TARIFAS = set(GRUPOS["Tarifas, juros e IOF"])

# Metas de referência usadas para o status de cada indicador.
METAS = {
    "poupanca": 20,        # % da renda guardada (mínimo 10%)
    "reserva": 6,          # meses de despesa em conta (mínimo 3)
    "fixos": 50,           # % da renda em gastos fixos (máximo)
    "carro": 15,           # % da renda com carro e transporte (máximo)
    "comer_fora": 5,       # % da renda com restaurante/delivery (máximo)
    "limite": 30,          # % do limite do cartão em uso (máximo)
    "parcelas": 10,        # % da renda mensal já comprometida com parcelas futuras (máximo)
}


def mes_da_transacao(t):
    """Compras no cartão contam no mês de vencimento da parcela; o resto, na data."""
    if t["account_type"] == "CREDIT":
        return (t.get("installment_due_date") or t["date"])[:7]
    return t["date"][:7]


def classificar(t):
    """Retorna ("receita"|"despesa"|"aplicacao"|"interna", valor_positivo)."""
    cat = t.get("category") or "Sem categoria"
    valor = t["amount"]
    pagamento_pix_fatura = t["account_type"] == "CREDIT" and t["type"] == "CREDIT" and cat == "Transferência - PIX"
    if cat in INTERNAS or pagamento_pix_fatura:
        destino = t.get("description", "").upper()
        if (cat in APLICACOES and t["account_type"] == "BANK" and valor < 0
                and not any(d in destino for d in DESTINOS_FATURA)):
            return "aplicacao", -valor
        return "interna", abs(valor)
    if t["account_type"] == "BANK":
        return ("receita", valor) if valor > 0 else ("despesa", -valor)
    return "despesa", valor  # cartão: estorno entra negativo e abate a despesa


def nome_estabelecimento(desc):
    s = desc.upper()
    s = re.sub(r"\d{1,2}/\d{1,2}\s*$", "", s)
    s = re.sub(r"^(PIX ENVIADO|PAGAMENTO DE BOLETO( OUTROS BANCOS)?|PIX RECEBIDO|COMPRA CARTAO DEB MC|PAGAMENTO CONTA)\s*", "", s)
    s = re.sub(r"(SAO PAULO|NOVO HAMBURGO|PORTO ALEGRE|RIO)\s*BR\s*$|BR$", "", s)
    s = re.sub(r"[^A-Z ]", " ", s)
    return " ".join(s.split()[:3]).title() or desc[:20]


def lista_meses(inicio, fim):
    meses, (y, m) = [], (inicio.year, inicio.month)
    while (y, m) <= (fim.year, fim.month):
        meses.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return meses


def _pct(a, b):
    return round(a / b * 100, 1) if b else None


def _status(valor, meta, maior_melhor, tolerancia):
    """good / warning / critical. tolerancia = limite do aceitável."""
    if valor is None:
        return "warning"
    if maior_melhor:
        return "good" if valor >= meta else "warning" if valor >= tolerancia else "critical"
    return "good" if valor <= meta else "warning" if valor <= tolerancia else "critical"


def calcular(transacoes, saldo, fatura, parcelas, hoje):
    """Monta o dicionário consumido pelo painel."""
    meses = lista_meses(dt.date(hoje.year - 1, hoje.month, 1), hoje)  # 12 completos + mês atual
    completos, atual = meses[:-1], meses[-1]

    rec, desp, aplic, fixos = (collections.defaultdict(float) for _ in range(4))
    por_grupo = collections.defaultdict(lambda: collections.defaultdict(float))
    por_cat = collections.defaultdict(lambda: collections.defaultdict(float))
    estab = collections.defaultdict(lambda: collections.defaultdict(float))

    for t in transacoes:
        m = mes_da_transacao(t)
        if m not in meses:
            continue
        tipo, v = classificar(t)
        cat = t.get("category") or "Sem categoria"
        if tipo == "receita":
            rec[m] += v
        elif tipo == "aplicacao":
            aplic[m] += v
        elif tipo == "despesa":
            desp[m] += v
            por_grupo[GRUPO_DE.get(cat, "Outros")][m] += v
            por_cat[cat][m] += v
            if cat in FIXOS:
                fixos[m] += v
            if v > 0:
                estab[nome_estabelecimento(t.get("description", ""))][m] += v

    def soma(d, ms):
        return sum(d[m] for m in ms)

    n = len(completos)
    renda_12m, desp_12m = soma(rec, completos), soma(desp, completos)
    renda_media, desp_media = renda_12m / n, desp_12m / n
    ultimos3 = completos[-3:]
    renda_3m, desp_3m = soma(rec, ultimos3), soma(desp, ultimos3)

    cartoes = [c for c in fatura.get("accounts", []) if (c.get("credit_limit") or 0) > 1]
    limite_total = sum(c["credit_limit"] for c in cartoes)
    limite_usado = sum(c["credit_limit"] - c["available_credit_limit"] for c in cartoes)

    mes_atual_str = hoje.strftime("%Y-%m")
    parcelas_futuras = collections.defaultdict(float)
    for card in parcelas.get("purchasesByCard", []):
        for p in card.get("purchases", []):
            for i in p.get("installments", []):
                if i["dueDate"][:7] > mes_atual_str:
                    parcelas_futuras[i["dueDate"][:7]] += i["amount"]
    total_parcelas = sum(parcelas_futuras.values())

    carro = soma(por_grupo["Carro e transporte"], completos)
    comer_fora = sum(soma(por_cat[c], completos) for c in COMER_FORA)
    tarifas = sum(soma(por_cat[c], completos) for c in TARIFAS)
    aplicado = soma(aplic, completos)

    ind = {
        "poupanca": _pct(renda_12m - desp_12m, renda_12m),
        "poupanca_3m": _pct(renda_3m - desp_3m, renda_3m),
        "reserva": round(saldo["total_balance"] / desp_media, 1) if desp_media else None,
        "fixos": _pct(soma(fixos, completos), renda_12m),
        "carro": _pct(carro, renda_12m),
        "comer_fora": _pct(comer_fora, renda_12m),
        "limite": _pct(limite_usado, limite_total),
        "parcelas": _pct(total_parcelas, renda_media),
    }
    status = {
        "poupanca": _status(ind["poupanca"], METAS["poupanca"], True, 10),
        "poupanca_3m": _status(ind["poupanca_3m"], METAS["poupanca"], True, 10),
        "reserva": _status(ind["reserva"], METAS["reserva"], True, 3),
        "fixos": _status(ind["fixos"], METAS["fixos"], False, 60),
        "carro": _status(ind["carro"], METAS["carro"], False, 25),
        "comer_fora": _status(ind["comer_fora"], METAS["comer_fora"], False, 10),
        "limite": _status(ind["limite"], METAS["limite"], False, 50),
        "parcelas": _status(ind["parcelas"], METAS["parcelas"], False, 20),
    }

    # Ritmo do mês atual: gasto até hoje × média mensal, projetado pelos dias corridos.
    dias_mes = ((dt.date(hoje.year + hoje.month // 12, hoje.month % 12 + 1, 1)) - dt.timedelta(days=1)).day
    gasto_atual = desp[atual]
    projecao = gasto_atual / hoje.day * dias_mes if hoje.day else 0
    grupos_ordenados = sorted(por_grupo, key=lambda g: -soma(por_grupo[g], completos))
    mes_atual = {
        "mes": atual, "dia": hoje.day, "dias": dias_mes,
        "receita": round(rec[atual], 2), "despesa": round(gasto_atual, 2),
        "projecao": round(projecao, 2), "media": round(desp_media, 2),
        "grupos": [{"grupo": g, "atual": round(por_grupo[g][atual], 2),
                    "media": round(soma(por_grupo[g], completos) / n, 2)} for g in grupos_ordenados],
    }

    recorrentes = []
    for nome, pm in estab.items():
        ativos = [m for m in completos if pm.get(m)]
        if len(ativos) >= 6:
            recorrentes.append({"nome": nome, "meses": len(ativos),
                                "media": round(statistics.mean(pm[m] for m in ativos), 2),
                                "total": round(soma(pm, completos), 2)})
    recorrentes.sort(key=lambda r: -r["total"])

    return {
        "gerado_em": dt.datetime.now().isoformat(timespec="minutes"),
        "hoje": hoje.isoformat(),
        "meses": completos,
        "metas": METAS,
        "indicadores": ind,
        "status": status,
        "totais": {
            "renda_12m": round(renda_12m, 2), "despesa_12m": round(desp_12m, 2),
            "renda_media": round(renda_media, 2), "despesa_media": round(desp_media, 2),
            "saldo": saldo["total_balance"], "aplicado_12m": round(aplicado, 2),
            "tarifas_12m": round(tarifas, 2), "carro_12m": round(carro, 2), "comer_fora_12m": round(comer_fora, 2),
            "limite_total": round(limite_total, 2), "limite_usado": round(limite_usado, 2),
            "fatura_atual": round(fatura.get("totalAmount", 0), 2), "parcelas_futuras": round(total_parcelas, 2),
        },
        "serie": {
            "receita": [round(rec[m], 2) for m in completos],
            "despesa": [round(desp[m], 2) for m in completos],
            "fixos": [round(fixos[m], 2) for m in completos],
            "poupanca": [_pct(rec[m] - desp[m], rec[m]) for m in completos],
            "grupos": {g: [round(por_grupo[g][m], 2) for m in completos] for g in grupos_ordenados},
        },
        "mes_atual": mes_atual,
        "parcelas_por_mes": {k: round(v, 2) for k, v in sorted(parcelas_futuras.items())},
        "recorrentes": recorrentes[:12],
        "contas": [{"nome": a["name"], "saldo": a["balance"]} for a in saldo.get("accounts", []) if a.get("balance")],
        "cartoes": [{"nome": c["account_name"], "limite": c["credit_limit"], "disponivel": c["available_credit_limit"],
                     "fatura": c.get("calculated_bill_amount")} for c in cartoes],
    }
