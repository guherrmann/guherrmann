"""Retorno total mensal da carteira (cotação + proventos) com o histórico oficial da B3 (COTAHIST).

Cotações de fechamento do último pregão de cada mês ficam em financas/dados/precos_fim_mes.json,
para que só os meses novos sejam baixados (cada arquivo mensal da B3 tem cerca de 10 MB).
"""
import datetime as dt
import io
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
import zipfile

URL_MES = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M{mm}{aaaa}.ZIP"
URL_DIA = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D{dd}{mm}{aaaa}.ZIP"
# Códigos antigos de ativos renomeados: o histórico usa o código da época.
CODIGO_ANTIGO = {"AXIA3": "ELET3", "AXIA6": "ELET6"}


def _log(msg):
    print("  " + msg, file=sys.stderr)


def _baixar(url):
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "painel-financeiro/1.0"}), timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if tentativa == 2:
                raise
        except urllib.error.URLError:
            if tentativa == 2:
                raise
        time.sleep(2 ** (tentativa + 1))


def _fechamentos(conteudo, codigos):
    """{codigo: (data, fechamento)} do último pregão presente no arquivo, mercado à vista."""
    out = {}
    z = zipfile.ZipFile(io.BytesIO(conteudo))
    for nome in z.namelist():
        for linha in io.TextIOWrapper(z.open(nome), encoding="latin1"):
            if not linha.startswith("01") or linha[24:27] != "010":
                continue
            cod = linha[12:24].strip()
            if cod in codigos:
                data = linha[2:10]
                if cod not in out or data >= out[cod][0]:
                    out[cod] = (data, int(linha[108:121]) / 100)
    return out


def precos_fim_mes(tickers, meses, hoje, cache_path):
    """{mes: {ticker: fechamento}} para os meses pedidos. O mês corrente usa o último pregão disponível."""
    cache_path = pathlib.Path(cache_path)
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    atual = hoje.strftime("%Y-%m")
    codigos = {t: CODIGO_ANTIGO.get(t, t) for t in tickers}
    procurar = set(codigos.values()) | set(tickers)
    for mes in meses:
        faltam = [t for t in tickers if t not in cache.get(mes, {})]
        if not faltam or (mes == atual):
            continue
        aaaa, mm = mes.split("-")
        conteudo = _baixar(URL_MES.format(mm=mm, aaaa=aaaa))
        if not conteudo:
            _log(f"B3: arquivo de {mes} indisponível")
            continue
        f = _fechamentos(conteudo, procurar)
        cache.setdefault(mes, {})
        for t, c in codigos.items():
            v = f.get(t) or f.get(c)
            if v:
                cache[mes][t] = v[1]
        _log(f"B3: cotações de {mes} ({len(cache[mes])} ativos)")
    # Mês corrente: arquivo diário mais recente (até 10 dias para trás).
    d = hoje
    for _ in range(10):
        conteudo = _baixar(URL_DIA.format(dd=d.strftime("%d"), mm=d.strftime("%m"), aaaa=d.year))
        if conteudo:
            f = _fechamentos(conteudo, procurar)
            if f:
                cache[atual] = {t: (f.get(t) or f.get(c))[1] for t, c in codigos.items() if f.get(t) or f.get(c)}
                cache.setdefault("_datas", {})[atual] = d.isoformat()
                _log(f"B3: cotações do pregão de {d}")
                break
        d -= dt.timedelta(days=1)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False))
    return cache


def retorno_mensal(posicoes, fluxos, proventos, precos, meses):
    """Retorno de cada mês pelo método de Dietz modificado.

    posicoes: {mes: {ticker: cotas no fim do mês}}; fluxos: {mes: compras − vendas em R$};
    proventos: {mes: R$}; precos: {mes: {ticker: fechamento}}.
    r = (valor_fim + proventos − valor_início − fluxo) / (valor_início + fluxo/2)
    """
    def valor(mes):
        pos, px = posicoes.get(mes, {}), precos.get(mes, {})
        if not pos or any(t not in px for t in pos):
            return None
        return sum(q * px[t] for t, q in pos.items())

    out = []
    for i, mes in enumerate(meses):
        fim = valor(mes)
        ini = valor(meses[i - 1]) if i else None
        fluxo, prov = fluxos.get(mes, 0.0), proventos.get(mes, 0.0)
        r = None
        if fim is not None and ini is not None and (ini + fluxo / 2) > 0:
            r = (fim + prov - ini - fluxo) / (ini + fluxo / 2)
        out.append({"mes": mes, "valor": round(fim, 2) if fim is not None else None, "retorno_mes": round(r, 6) if r is not None else None})
    return out
