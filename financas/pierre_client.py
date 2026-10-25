"""Cliente mínimo (somente leitura) da API REST do Pierre Finance.

A chave pode vir de dois lugares:
- da variável de ambiente PIERRE_API_KEY (uso local); ou
- de um "network secret" do ambiente cloud do Claude Code, que injeta o
  cabeçalho Authorization no proxy. Nesse caso, nenhuma chave é necessária aqui.
"""
import json
import os
import time
import urllib.parse
import urllib.request

BASE_URL = "https://www.pierre.finance/tools/api"


class PierreError(RuntimeError):
    pass


def _get(endpoint, params=None, timeout=90, retries=3):
    url = f"{BASE_URL}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    headers = {"Accept": "application/json"}
    key = os.environ.get("PIERRE_API_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
                body = json.load(r)
            if not body.get("success", True):
                raise PierreError(f"{endpoint}: {body.get('message') or body}")
            return body
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise PierreError(f"{endpoint}: acesso negado ({e.code}). Verifique a chave/assinatura.") from e
            if attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2 ** (attempt + 1))


def get_accounts():
    return _get("get-accounts")["data"]


def get_balance():
    return _get("get-balance")["data"]


def get_bill_summary():
    return _get("get-bill-summary")["data"]


def get_installments(start, end):
    return _get("get-installments", {"startDate": start, "endDate": end})["data"]


def get_transactions(start, end):
    return _get("get-transactions", {"startDate": start, "endDate": end})["data"]
