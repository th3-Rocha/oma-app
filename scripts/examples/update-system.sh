#!/usr/bin/env bash
# desc: Mostra quantos pacotes têm atualização pendente
count=$(checkupdates 2>/dev/null | wc -l)
echo "$count pacote(s) com atualização disponível"
