"""Importa o extrato de movimentação da Área do Investidor da B3 (Extratos → Movimentação, .xlsx).

Uso: python3 financas/b3.py caminho/movimentacao.xlsx
Gera financas/dados/b3_posicao.json com, para cada ativo que você ainda tem:
quantidade, custo das compras, proventos recebidos desde a compra e quanto o
mesmo dinheiro teria virado no CDI (líquido de 15% de IR).
"""
import collections
import datetime as dt
import json
import pathlib
import sys

PROVENTOS = {"Rendimento", "Dividendo", "Juros Sobre Capital Próprio"}
COMPRA_VENDA = "Transferência - Liquidação"
# Ativos que mudaram de código: o antigo passa a contar como o novo.
RENOMEADOS = {"ELET3": "AXIA3", "ELET6": "AXIA6"}
DADOS = pathlib.Path(__file__).parent / "dados"


def _data(s):
    return dt.datetime.strptime(s, "%d/%m/%Y").date()


def _num(x):
    return float(x) if isinstance(x, (int, float)) else None


def ler(caminho):
    import openpyxl  # o cabeçalho do arquivo da B3 informa o tamanho errado: não usar read_only

    ws = openpyxl.load_workbook(caminho).active
    linhas = []
    for r in list(ws.iter_rows(values_only=True))[1:]:
        if not r or not r[1]:
            continue
        produto = str(r[3]).strip()
        codigo = produto.split(" - ")[0].strip()
        linhas.append({"sentido": r[0], "data": _data(r[1]), "mov": r[2], "produto": produto,
                       "ativo": RENOMEADOS.get(codigo, codigo), "qtd": _num(r[5]) or 0,
                       "preco": _num(r[6]), "valor": _num(r[7])})
    return sorted(linhas, key=lambda x: x["data"])


def posicao(linhas, hoje, cdi_mensal=None):
    """cdi_mensal: {"AAAA-MM": % do mês} para corrigir as compras pelo CDI."""
    por_ativo = collections.defaultdict(list)
    for x in linhas:
        por_ativo[x["ativo"]].append(x)

    resultado = {}
    for ativo, ev in por_ativo.items():
        if ativo.startswith("Tesouro"):
            # Cada transferência entre corretoras gera uma entrada e uma saída; contam as entradas
            # (a corretora atual) menos os resgates. Compras feitas antes do extrato não aparecem.
            entrou = sum(e["qtd"] for e in ev if e["mov"] in ("Transferencia", "Transferência") and e["sentido"] == "Credito")
            resgatado = sum(e["qtd"] for e in ev if e["mov"] == "Resgate")
            qtd = entrou - resgatado
            if qtd > 0:
                resultado[ativo] = {"classe": "Tesouro", "cotas": round(qtd, 2), "custo": None, "proventos": 0.0,
                                    "desde": None, "valor_cdi": None, "custodia_paga": round(sum(e["valor"] or 0 for e in ev if e["mov"].startswith("Cobrança")), 2)}
            continue
        prov = [e for e in ev if e["mov"] in PROVENTOS and e["sentido"] == "Credito"]
        if not prov:
            continue
        ultimo = prov[-1]
        if (hoje - ultimo["data"]).days > 400:
            continue  # sem proventos há mais de um ano: vendido ou sem dados
        qtd = ultimo["qtd"]
        for e in ev:  # compras e vendas depois do último provento
            if e["mov"] == COMPRA_VENDA and e["data"] > ultimo["data"]:
                qtd += e["qtd"] if e["sentido"] == "Credito" else -e["qtd"]
        if qtd <= 0:
            continue
        compras = [e for e in ev if e["mov"] == COMPRA_VENDA and e["sentido"] == "Credito" and e["valor"]]
        custo = sum(e["valor"] for e in compras)
        valor_cdi = None
        if cdi_mensal and compras:
            valor_cdi = sum(e["valor"] * _fator_cdi(cdi_mensal, e["data"], hoje) for e in compras)
            # IR de 15% sobre o ganho no CDI (prazo acima de 2 anos; aproximação).
            valor_cdi = custo + (valor_cdi - custo) * 0.85
        resultado[ativo] = {"classe": "FII" if ativo.endswith("11") else "Ação", "cotas": qtd, "custo": round(custo, 2) or None,
                            "proventos": round(sum(e["valor"] or 0 for e in prov), 2),
                            "desde": compras[0]["data"].isoformat() if compras else None,
                            "valor_cdi": round(valor_cdi, 2) if valor_cdi else None}
    return resultado


def historico_mensal(linhas, ativos_atuais, hoje):
    """Proventos recebidos e custo acumulado das compras, mês a mês, dos ativos que você tem hoje."""
    atuais = {a for a in ativos_atuais if not a.startswith("Tesouro")}
    prov, compras = collections.defaultdict(float), []
    for e in linhas:
        if e["ativo"] not in atuais:
            continue
        if e["mov"] in PROVENTOS and e["sentido"] == "Credito":
            prov[e["data"].strftime("%Y-%m")] += e["valor"] or 0
        elif e["mov"] == COMPRA_VENDA and e["valor"]:
            compras.append((e["data"].strftime("%Y-%m"), e["valor"] if e["sentido"] == "Credito" else -e["valor"]))
    if not compras:
        return []
    meses, (y, m) = [], map(int, min(c[0] for c in compras).split("-"))
    while (y, m) <= (hoje.year, hoje.month):
        meses.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    out, custo = [], 0.0
    for mes in meses:
        custo += sum(v for c, v in compras if c == mes)
        out.append({"mes": mes, "proventos": round(prov.get(mes, 0.0), 2), "custo": round(custo, 2)})
    return out


def _fator_cdi(cdi_mensal, inicio, fim):
    f = 1.0
    for mes, taxa in sorted(cdi_mensal.items()):
        if inicio.strftime("%Y-%m") <= mes <= fim.strftime("%Y-%m"):
            f *= 1 + taxa / 100
    return f


def cdi_mensal_desde(inicio):
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    import mercado
    return {d.strftime("%Y-%m"): v for d, v in mercado.sgs(4391, inicio=inicio)}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    linhas = ler(sys.argv[1])
    hoje = dt.date.today()
    cdi = cdi_mensal_desde(linhas[0]["data"].replace(day=1))
    pos = posicao(linhas, hoje, cdi)
    DADOS.mkdir(exist_ok=True)
    saida = {"gerado_em": hoje.isoformat(), "periodo": [linhas[0]["data"].isoformat(), linhas[-1]["data"].isoformat()], "ativos": pos,
             "mensal": historico_mensal(linhas, pos, hoje)}
    (DADOS / "b3_posicao.json").write_text(json.dumps(saida, ensure_ascii=False, indent=1))
    for a, p in sorted(pos.items()):
        print(f"{a:20} {p['cotas']:>8} custo={p['custo']} proventos={p['proventos']} cdi={p['valor_cdi']} desde={p['desde']}")


if __name__ == "__main__":
    main()
