import datetime as dt
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import indicadores as I  # noqa: E402


def tx(account_type, type_, amount, category, date="2026-09-10", desc="X", due=None):
    return {"account_type": account_type, "type": type_, "amount": amount, "category": category,
            "date": date + "T12:00:00.000Z", "installment_due_date": due, "description": desc}


class ClassificarTest(unittest.TestCase):
    def test_compra_no_cartao_e_despesa(self):
        self.assertEqual(I.classificar(tx("CREDIT", "DEBIT", 50, "Supermercado")), ("despesa", 50))

    def test_estorno_no_cartao_abate_despesa(self):
        self.assertEqual(I.classificar(tx("CREDIT", "CREDIT", -20, "Compras")), ("despesa", -20))

    def test_pagamento_de_fatura_e_interno(self):
        self.assertEqual(I.classificar(tx("BANK", "DEBIT", -900, "Pagamento de cartão de crédito"))[0], "interna")
        self.assertEqual(I.classificar(tx("CREDIT", "CREDIT", -900, "Transferência - PIX"))[0], "interna")

    def test_pix_para_banco_do_cartao_nao_e_aplicacao(self):
        t = tx("BANK", "DEBIT", -4000, "Investimentos", desc="PIX ENVIADO ITAU UNIBANCO HOLDING")
        self.assertEqual(I.classificar(t)[0], "interna")

    def test_aplicacao(self):
        self.assertEqual(I.classificar(tx("BANK", "DEBIT", -100, "Fundos multimercado")), ("aplicacao", 100))

    def test_salario_e_receita(self):
        self.assertEqual(I.classificar(tx("BANK", "CREDIT", 5000, "Salário")), ("receita", 5000))

    def test_parcela_conta_no_mes_de_vencimento(self):
        t = tx("CREDIT", "DEBIT", 100, "Compras", date="2026-08-05", due="2026-10-05T00:00:00.000Z")
        self.assertEqual(I.mes_da_transacao(t), "2026-10")


class CalcularTest(unittest.TestCase):
    def test_indicadores_basicos(self):
        hoje = dt.date(2026, 10, 15)
        txs = []
        for m in I.lista_meses(dt.date(2025, 10, 1), dt.date(2026, 9, 1)):
            txs.append(tx("BANK", "CREDIT", 10000, "Salário", date=m + "-05"))
            txs.append(tx("BANK", "DEBIT", -2000, "Moradia", date=m + "-10"))
            txs.append(tx("CREDIT", "DEBIT", 6000, "Supermercado", date=m + "-12", due=m + "-20T00:00:00Z"))
        r = I.calcular(txs, {"total_balance": 24000, "accounts": []}, {"accounts": [], "totalAmount": 0},
                       {"purchasesByCard": []}, hoje)
        self.assertEqual(len(r["meses"]), 12)
        self.assertEqual(r["indicadores"]["poupanca"], 20.0)
        self.assertEqual(r["indicadores"]["reserva"], 3.0)
        self.assertEqual(r["indicadores"]["fixos"], 20.0)
        self.assertEqual(r["status"]["poupanca"], "good")
        self.assertEqual(r["status"]["reserva"], "warning")


if __name__ == "__main__":
    unittest.main()
