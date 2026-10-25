# Painel financeiro (Pierre Finance)

Gera um painel HTML com indicadores financeiros a partir dos dados do
[Pierre](https://docs.pierre.finance/), que reúne as contas bancárias via Open Finance.
O acesso à API é **somente leitura**.

## Como rodar

```bash
python3 financas/gerar_painel.py           # busca os dados na API e gera o painel
python3 financas/gerar_painel.py --cache   # recalcula com os dados já baixados
python3 -m unittest financas/test_indicadores.py
```

O painel sai em `financas/saida/painel.html`. Não há dependências além do Python 3 (biblioteca padrão).

### Autenticação

- **Ambiente cloud do Claude Code:** a chave fica como *network secret* do ambiente
  (cabeçalho `Authorization: Bearer …` para `*.pierre.finance`). Ela é injetada pelo proxy
  e não aparece no código nem na sessão.
- **Local:** `export PIERRE_API_KEY=sk-...` antes de rodar.

Nunca coloque a chave no repositório.

## Privacidade

`financas/dados/` (respostas brutas da API) e `financas/saida/` (painel com seus números)
estão no `.gitignore`. Só o código é versionado.

## Indicadores

| Indicador | Cálculo | Meta |
|---|---|---|
| Taxa de poupança (12m e 3m) | (entradas − saídas) / entradas | ≥ 20% (mín. 10%) |
| Reserva de emergência | saldo em conta / saída média mensal | ≥ 6 meses (mín. 3) |
| Gastos fixos / renda | moradia, contas, seguros, assinaturas / entradas | ≤ 50% |
| Carro e transporte / renda | combustível, manutenção, seguro, pedágio… / entradas | ≤ 15% |
| Restaurante e delivery / renda | / entradas | ≤ 5% |
| Uso do limite dos cartões | limite usado / limite total | ≤ 30% |
| Parcelas futuras / renda mensal | parcelas a vencer / entrada média mensal | ≤ 10% |

As metas ficam em `METAS`, em `indicadores.py`.

### Regras de classificação

- **Entradas:** créditos em conta (salário, PIX recebidos, rendimentos).
- **Saídas:** compras no cartão, no mês de vencimento da parcela e com estornos descontados, mais os débitos em conta.
- **Ignorados:** pagamentos de fatura, transferências entre contas próprias e aplicações ou resgates.
  Um PIX "Investimentos" para o banco emissor do cartão (Itaú, Nubank) é tratado como pagamento de fatura.
- Os indicadores anuais usam os 12 últimos meses **completos**. O mês corrente aparece no quadro de ritmo, com a projeção até o fim do mês.

## Arquivos

- `pierre_client.py`: chamadas à API REST do Pierre
- `indicadores.py`: classificação das transações e cálculo dos indicadores
- `gerar_painel.py`: baixa os dados, calcula e preenche o template
- `painel_template.html`: o painel (HTML + SVG, sem bibliotecas externas)
