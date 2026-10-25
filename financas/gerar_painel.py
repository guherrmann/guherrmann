"""Busca os dados no Pierre, calcula os indicadores e gera o painel HTML.

Uso:
    python3 financas/gerar_painel.py                 # busca na API e gera o painel
    python3 financas/gerar_painel.py --cache         # reaproveita os dados já baixados
    python3 financas/gerar_painel.py --saida x.html  # escolhe o arquivo de saída

Os dados brutos ficam em financas/dados/ e o painel em financas/saida/.
As duas pastas estão no .gitignore: nada financeiro vai para o repositório.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import indicadores  # noqa: E402
import pierre_client as pierre  # noqa: E402

AQUI = pathlib.Path(__file__).parent
DADOS = AQUI / "dados"


def baixar(hoje):
    DADOS.mkdir(exist_ok=True)
    meses = indicadores.lista_meses(dt.date(hoje.year - 1, hoje.month, 1), hoje)
    transacoes = []
    for m in meses:
        y, mm = map(int, m.split("-"))
        inicio = dt.date(y, mm, 1)
        fim = min(dt.date(y + mm // 12, mm % 12 + 1, 1) - dt.timedelta(days=1), hoje)
        lote = pierre.get_transactions(inicio.isoformat(), fim.isoformat())
        print(f"  {m}: {len(lote)} transações", file=sys.stderr)
        transacoes += lote
    vistos, unicas = set(), []
    for t in transacoes:
        if t["id"] not in vistos:
            vistos.add(t["id"])
            unicas.append(t)
    bruto = {
        "transacoes": unicas,
        "saldo": pierre.get_balance(),
        "fatura": pierre.get_bill_summary(),
        "parcelas": pierre.get_installments(dt.date(hoje.year - 1, hoje.month, 1).isoformat(), hoje.isoformat()),
        "baixado_em": hoje.isoformat(),
    }
    (DADOS / "bruto.json").write_text(json.dumps(bruto, ensure_ascii=False))
    return bruto


def exportar_datasets(r, pasta):
    """Grava os conjuntos de dados do painel interativo (Artifact Dashboard) como JSON de linhas."""
    pasta = pathlib.Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    s = r["serie"]
    carro = s["grupos"].get("Carro e transporte", [0] * len(r["meses"]))
    ma = r["mes_atual"]
    conjuntos = {
        "mensal": [{"mes": m, "receita": s["receita"][i], "despesa": s["despesa"][i], "fixos": s["fixos"][i],
                    "carro": carro[i], "comer_fora": s["comer_fora"][i], "aplicado": s["aplicado"][i]}
                   for i, m in enumerate(r["meses"])],
        "grupos": [{"mes": m, "grupo": g, "valor": v[i]} for g, v in s["grupos"].items() for i, m in enumerate(r["meses"])],
        "contas": [{"conta": c["nome"], "saldo": c["saldo"]} for c in r["contas"]],
        "cartoes": [{"cartao": c["nome"], "limite": c["limite"], "disponivel": c["disponivel"],
                     "fatura": c["fatura"] or 0} for c in r["cartoes"]],
        "parcelas": [{"mes": m, "valor": v} for m, v in r["parcelas_por_mes"].items()],
        "mes_atual": [{"mes": ma["mes"], "dia": ma["dia"], "dias": ma["dias"], "receita": ma["receita"],
                       "despesa": ma["despesa"], "grupo": g["grupo"], "valor": g["atual"]} for g in ma["grupos"]],
        "recorrentes": [{"estabelecimento": x["nome"], "meses": x["meses"], "media": x["media"], "total": x["total"]}
                        for x in r["recorrentes"]],
    }
    for nome, linhas in conjuntos.items():
        (pasta / f"{nome}.json").write_text(json.dumps(linhas, ensure_ascii=False))
    return list(conjuntos)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", action="store_true", help="usar financas/dados/bruto.json em vez da API")
    ap.add_argument("--saida", default=str(AQUI / "saida" / "painel.html"))
    ap.add_argument("--datasets", help="pasta onde gravar os JSON do painel interativo no Claude")
    ap.add_argument("--hoje", help="data de referência AAAA-MM-DD (padrão: hoje)")
    args = ap.parse_args()

    if args.cache:
        bruto = json.loads((DADOS / "bruto.json").read_text())
        hoje = dt.date.fromisoformat(args.hoje or bruto["baixado_em"])
    else:
        hoje = dt.date.fromisoformat(args.hoje) if args.hoje else dt.date.today()
        print("Baixando dados do Pierre...", file=sys.stderr)
        bruto = baixar(hoje)

    resumo = indicadores.calcular(bruto["transacoes"], bruto["saldo"], bruto["fatura"], bruto["parcelas"], hoje)
    html = (AQUI / "painel_template.html").read_text().replace(
        "__DADOS__", json.dumps(resumo, ensure_ascii=False).replace("</", "<\\/"))
    saida = pathlib.Path(args.saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(html)
    print(f"Painel gerado em {saida}", file=sys.stderr)
    if args.datasets:
        nomes = exportar_datasets(resumo, args.datasets)
        print(f"Conjuntos de dados em {args.datasets}: {', '.join(nomes)}", file=sys.stderr)
    print(json.dumps({"indicadores": resumo["indicadores"], "status": resumo["status"]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
