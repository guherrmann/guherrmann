"""Dados de mercado para a área de investimentos do painel.

Fontes (todas gratuitas):
- Banco Central (SGS e Focus/Olinda): Selic, CDI, IPCA, IGP-M e expectativas.
- Tesouro Transparente: taxas de todos os títulos do Tesouro Direto (CSV oficial).
  Se o arquivo estiver indisponível, usa os 3 títulos que a brapi libera no plano gratuito.
- brapi.dev: cotações de FIIs, Fiagros, ações e ETFs (chave gratuita via network secret).
- CVM Dados Abertos: informes mensais de FIIs e Fiagros (valor patrimonial, dividend yield).
"""
import csv
import datetime as dt
import io
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

# Universo de comparação. A carteira do usuário é somada a ele automaticamente.
FIIS_CANDIDATOS = [
    "KNCR11", "KNIP11", "KNSC11", "CPTS11", "MXRF11", "RECR11", "IRDM11", "HGCR11", "VGIR11", "RBRR11",
    "HGLG11", "BTLG11", "XPLG11", "VILG11", "LVBI11",
    "XPML11", "VISC11", "HSML11",
    "KNRI11", "HGRU11", "TRXF11",
    "FGAA11", "VGIA11", "KNCA11", "RZAG11", "SNAG11",
]
SEGMENTOS = {
    **dict.fromkeys(["KNCR11", "KNIP11", "KNSC11", "CPTS11", "MXRF11", "RECR11", "IRDM11", "HGCR11", "VGIR11", "RBRR11"], "Papel (CRI)"),
    **dict.fromkeys(["HGLG11", "BTLG11", "XPLG11", "VILG11", "LVBI11"], "Logística"),
    **dict.fromkeys(["XPML11", "VISC11", "HSML11"], "Shoppings"),
    "KNRI11": "Híbrido", "HGRU11": "Renda urbana", "TRXF11": "Renda urbana",
    **dict.fromkeys(["FGAA11", "VGIA11", "KNCA11", "RZAG11", "SNAG11"], "Fiagro (CRA)"),
}
ETFS = {
    "BOVA11": "Ibovespa", "SMAL11": "Small caps", "DIVO11": "Dividendos", "IVVB11": "S&P 500 (dólar)",
    "IMAB11": "Tesouro IPCA+ (IMA-B)", "B5P211": "IPCA+ até 5 anos", "LFTS11": "Tesouro Selic",
}

SGS = {"selic_meta": 432, "cdi": 4389, "selic_efetiva": 1178, "ipca_12m": 13522, "ipca_mes": 433, "igpm_mes": 189}
TESOURO_CSV = ("https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/"
               "resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv")
BRAPI_TESOURO_GRATIS = ["tesouro-selic-01032031", "tesouro-prefixado-com-juros-semestrais-01012037",
                        "tesouro-ipca-com-juros-semestrais-15082060"]


def _get(url, timeout=120, retries=3, binary=False):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "painel-financeiro/1.0", "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            return data if binary else data.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 402, 403, 404) or attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2 ** (attempt + 1))


def _log(msg):
    print("  " + msg, file=sys.stderr)


# --- Banco Central -------------------------------------------------------------------------

def sgs(codigo, inicio=None, ultimos=None):
    if ultimos:
        url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/{ultimos}?formato=json"
    else:
        url = (f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json"
               f"&dataInicial={inicio.strftime('%d/%m/%Y')}")
    for tentativa in range(4):  # o SGS às vezes devolve corpo vazio ou HTML; tentar de novo resolve
        try:
            linhas = json.loads(_get(url))
            break
        except ValueError:
            if tentativa == 3:
                raise
            time.sleep(5 * (tentativa + 1))
    return [(dt.datetime.strptime(x["data"], "%d/%m/%Y").date(), float(x["valor"])) for x in linhas]


def focus():
    filtro = "(Indicador eq 'IPCA' or Indicador eq 'Selic' or Indicador eq 'PIB Total') and baseCalculo eq 0"
    q = urllib.parse.urlencode({"$top": 40, "$orderby": "Data desc", "$filter": filtro, "$format": "json",
                                "$select": "Indicador,Data,DataReferencia,Mediana"}, quote_via=urllib.parse.quote)
    linhas = json.loads(_get("https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?" + q))["value"]
    ultima = max(x["Data"] for x in linhas)
    return [x for x in linhas if x["Data"] == ultima]


def cenario(hoje):
    """Indicadores atuais + histórico mensal de 24 meses de CDI, Selic e IPCA 12m."""
    atual = {}
    for nome, cod in SGS.items():
        serie = sorted(x for x in sgs(cod, ultimos=20) if x[0] <= hoje)  # a Selic meta já vem com datas futuras
        if not serie:
            serie = sorted(x for x in sgs(cod, inicio=hoje - dt.timedelta(days=90)) if x[0] <= hoje)
        atual[nome] = serie[-1]
    inicio = dt.date(hoje.year - 2, hoje.month, 1)
    hist = {}
    for nome in ("cdi", "selic_meta", "ipca_12m"):
        por_mes = {}
        for d, v in sgs(SGS[nome], inicio=inicio):
            if d <= hoje:
                por_mes[d.strftime("%Y-%m")] = v  # último valor do mês
        hist[nome] = por_mes
    ipca12 = sum(v for _, v in sgs(SGS["ipca_mes"], ultimos=12))  # aproximação simples só para conferência
    return atual, hist, focus(), ipca12


# --- Tesouro Direto ------------------------------------------------------------------------

def tesouro(cache=None):
    """Títulos do Tesouro Direto. `cache`: arquivo onde guardar a última leitura completa."""
    try:
        texto = _get(TESOURO_CSV, timeout=300, retries=2)
        if texto.lstrip().startswith("<"):
            raise RuntimeError("Tesouro Transparente devolveu uma página HTML (limite de acessos)")
        linhas = list(csv.DictReader(io.StringIO(texto), delimiter=";"))
        data_base = max(dt.datetime.strptime(x["Data Base"], "%d/%m/%Y").date() for x in linhas)
        out = []
        for x in linhas:
            if dt.datetime.strptime(x["Data Base"], "%d/%m/%Y").date() != data_base:
                continue
            venc = dt.datetime.strptime(x["Data Vencimento"], "%d/%m/%Y").date()
            if venc <= data_base:
                continue
            num = lambda s: float(s.replace(".", "").replace(",", ".")) if s else None
            out.append({"titulo": f"{x['Tipo Titulo']} {venc.year}", "tipo": x["Tipo Titulo"], "vencimento": venc.isoformat(),
                        "taxa_compra": num(x["Taxa Compra Manha"]), "preco_compra": num(x["PU Compra Manha"]),
                        "data_base": data_base.isoformat(), "fonte": "Tesouro Transparente"})
        _log(f"Tesouro: {len(out)} títulos em {data_base}")
        if cache:
            pathlib.Path(cache).write_text(json.dumps(out, ensure_ascii=False))
        return out
    except Exception as e:  # noqa: BLE001 - qualquer falha cai no plano B
        if cache and pathlib.Path(cache).exists():
            _log(f"Tesouro Transparente indisponível ({e}); usando a última leitura completa")
            return json.loads(pathlib.Path(cache).read_text())
        _log(f"Tesouro Transparente indisponível ({e}); usando a amostra gratuita da brapi")
    d = json.loads(_get("https://brapi.dev/api/v2/treasury/indicators?symbols=" + ",".join(BRAPI_TESOURO_GRATIS)))
    out = []
    for x in d.get("results", []):
        out.append({"titulo": f"{x['bondType']} {x['maturityDate'][:4]}", "tipo": x["bondType"], "vencimento": x["maturityDate"],
                    "taxa_compra": x["buyRate"], "preco_compra": x["buyPrice"], "data_base": x["baseDate"], "fonte": "brapi (amostra)"})
    return out


# --- Cotações (brapi) ----------------------------------------------------------------------

def cotacoes(tickers):
    out = {}
    for t in tickers:
        try:
            d = json.loads(_get(f"https://brapi.dev/api/quote/{t}?fundamental=true", timeout=30, retries=2))
            r = d["results"][0]
            out[t] = {"preco": r.get("regularMarketPrice"), "nome": r.get("longName") or r.get("shortName"),
                      "volume": r.get("regularMarketVolume"), "min52": r.get("fiftyTwoWeekLow"),
                      "max52": r.get("fiftyTwoWeekHigh"), "pl": r.get("priceEarnings"), "lpa": r.get("earningsPerShare"),
                      "data": (r.get("regularMarketTime") or "")[:10]}
        except Exception as e:  # noqa: BLE001
            _log(f"cotação {t}: {e}")
        time.sleep(0.3)
    return out


# --- CVM: informes mensais de FIIs e Fiagros -----------------------------------------------

def _csv_zip(url, nome_contem):
    z = zipfile.ZipFile(io.BytesIO(_get(url, timeout=300, binary=True)))
    for n in z.namelist():
        if nome_contem in n:
            return list(csv.DictReader(io.TextIOWrapper(z.open(n), encoding="latin1"), delimiter=";"))
    return []


def _f(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def informes_cvm(hoje):
    """{raiz_ticker: [ {mes, vp_cota, dy_mes(%), pl, cotistas, segmento, nome} ... ]} dos últimos ~13 meses."""
    por_raiz = {}
    inicio = dt.date(hoje.year - 1, hoje.month, 1)

    def add(raiz, mes, reg):
        # Um mesmo prefixo de ISIN pode ter várias classes: fica a de mais cotistas (a negociada em bolsa).
        atual = por_raiz.setdefault(raiz, {}).get(mes)
        if atual is None or (reg["cotistas"] or 0) > (atual["cotistas"] or 0):
            por_raiz[raiz][mes] = reg

    for ano in sorted({inicio.year, hoje.year}):
        base = f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip"
        try:
            geral = _csv_zip(base, "geral")
            comp = _csv_zip(base, "complemento")
        except Exception as e:  # noqa: BLE001
            _log(f"CVM FII {ano}: {e}")
            continue
        info = {}
        for g in geral:
            m = re.match(r"BR([A-Z]{4})CTF", g.get("Codigo_ISIN") or "")
            if m:
                info[(g["CNPJ_Fundo_Classe"], g["Data_Referencia"])] = (m.group(1), g.get("Segmento_Atuacao"), g.get("Nome_Fundo_Classe"), g.get("Mandato"))
        for c in comp:
            k = (c["CNPJ_Fundo_Classe"], c["Data_Referencia"])
            if k in info and c["Data_Referencia"][:7] >= inicio.strftime("%Y-%m"):
                raiz, seg, nome, mandato = info[k]
                add(raiz, c["Data_Referencia"][:7], {"vp_cota": _f(c.get("Valor_Patrimonial_Cotas")),
                    "dy_mes": _f(c.get("Percentual_Dividend_Yield_Mes")), "pl": _f(c.get("Patrimonio_Liquido")),
                    "cotistas": _f(c.get("Total_Numero_Cotistas")), "segmento": seg or mandato or "", "nome": nome, "tipo": "FII"})

    mes = inicio
    while mes <= hoje:
        url = f"https://dados.cvm.gov.br/dados/FIAGRO/DOC/INF_MENSAL/DADOS/inf_mensal_fiagro_{mes.strftime('%Y%m')}.zip"
        try:
            for r in _csv_zip(url, "fiagro_2"):
                m = re.match(r"BR([A-Z]{4})CTF", r.get("Codigo_ISIN") or "")
                if m:
                    add(m.group(1), r["Data_Referencia"][:7], {"vp_cota": _f(r.get("Valor_Patrimonial_Cotas")),
                        "dy_mes": _f(r.get("Dividend_Yield_Mes")), "pl": _f(r.get("Patrimonio_Liquido")),
                        "cotistas": _f(r.get("Numero_Cotistas")), "segmento": "Fiagro", "nome": r.get("Nome_Classe"), "tipo": "Fiagro"})
        except urllib.error.HTTPError:
            pass  # mês ainda não publicado
        except Exception as e:  # noqa: BLE001
            _log(f"CVM Fiagro {mes:%Y%m}: {e}")
        mes = dt.date(mes.year + mes.month // 12, mes.month % 12 + 1, 1)
    return por_raiz


def resumo_fundo(meses):
    """Último VP/cota e rendimento por cota dos últimos 12 meses informados."""
    chaves = sorted(meses)[-12:]
    ult = meses[chaves[-1]]
    rend, validos = 0.0, 0
    for k in chaves:
        r = rendimento_cota(meses[k]["dy_mes"], meses[k]["vp_cota"])
        if r is not None:
            rend += r
            validos += 1
    # Meses sem informação válida são preenchidos pela média dos válidos.
    rend_12m = rend / validos * 12 if validos else None
    return {**ult, "mes_ref": chaves[-1], "meses_validos": validos, "rend_12m_cota": rend_12m}


def rendimento_cota(dy, vp):
    """Rendimento do mês em R$ por cota.

    Os administradores preenchem o campo de DY de formas diferentes: fração (0,0106),
    percentual (1,16) ou até R$ por cota (0,13). Fica a leitura que dá um rendimento
    mensal plausível para fundos de renda (0,2% a 2,5% do valor patrimonial).
    """
    if not dy or not vp or dy <= 0 or vp <= 0:
        return None
    for valor in (dy * vp, dy / 100 * vp, dy):
        if 0.002 <= valor / vp <= 0.025:
            return valor
    return None
