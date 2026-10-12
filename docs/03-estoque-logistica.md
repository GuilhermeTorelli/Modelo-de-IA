# Setor de Estoque e Logística

## Armazéns e endereçamento
A Prisma tem dois pontos de armazenagem: o depósito de matéria-prima, dentro da fábrica, e o centro de distribuição (CD), onde ficam os produtos acabados. Todo item é guardado em um endereço no formato rua, prédio e nível, como A-12-3. Nenhum item pode ficar fora do endereço no sistema.

## Recebimento de mercadorias
No recebimento, a conferência é cega: o conferente conta os itens sem ver a quantidade da nota fiscal, e depois o sistema compara com o pedido de compra. Se a diferença de quantidade for maior que 2%, o lote vai para a quarentena e o setor de Compras é avisado em até 24 horas. Itens em quarentena não podem ser usados na produção nem vendidos.

## Estoque de segurança
O estoque de segurança de matéria-prima deve cobrir 20 dias de produção. O de produto acabado deve cobrir 15 dias de venda média. Quando um item cai abaixo do estoque de segurança, o sistema avisa o setor de Compras automaticamente.

## Inventário
O inventário é rotativo e segue a curva ABC: itens da classe A são contados todo mês, os da classe B a cada trimestre e os da classe C a cada semestre. Além disso, em dezembro é feito o inventário geral, com as operações paradas por 2 dias. Diferenças de inventário acima de 1% do valor do estoque precisam ser explicadas ao gerente de logística.

## Expedição e corte de pedidos
O horário de corte para expedição é 14h: pedidos faturados até esse horário saem no mesmo dia. Pedidos faturados depois do corte saem no dia útil seguinte. Na Grande Campo Grande a entrega é feita com frota própria. Para outros estados, a Prisma usa transportadoras terceirizadas.

## Seguro de carga
Pedidos acima de R$ 10.000 têm seguro de carga obrigatório, contratado pela Logística antes da saída. A nota fiscal desses pedidos deve mencionar o seguro.

## Entregas ao cliente
A entrega é agendada em uma janela de 4 horas. São feitas até 2 tentativas de entrega. Se o cliente estiver ausente nas duas, o pedido volta ao CD e o cliente paga um novo frete para reagendar.

## Avarias
Se o cliente receber um produto com avaria, ele deve registrar com fotos em até 24 horas após a entrega. A Logística aciona o transportador quando a avaria ocorreu no transporte. Avarias dentro da própria operação geram um relatório para a Qualidade da Produção. A troca ou o reparo é combinado com o Atendimento.

## Devoluções
Produtos devolvidos pelo cliente voltam ao CD e passam por inspeção antes de retornar ao estoque. Se o produto estiver em condição de venda, o estoque é atualizado e o Financeiro é avisado para liberar o reembolso.
