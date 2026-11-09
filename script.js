// ============ CONFIGURAÇÃO (edite só esta parte) ============
const CONFIG = {
  nomeIgreja: "Deus é Amor",
  endereco: "Rua Parapuã, 1382, São Paulo - SP",
  linkMapa: "https://maps.app.goo.gl/92STzDb4PeBNXfm28?g_st=aw",
  whatsapp: "5511999999999", // só números, com 55 + DDD
  // Link da planilha publicada como CSV. Se deixar vazio, usa o arquivo horarios.csv.
  urlPlanilha: "https://script.google.com/macros/s/AKfycbzbyISx4jOW4TqbM-mNEhQ29tBf_FCWFSUm7Mlond0bOWGYIIDWHYsId6Svkn7fq0RhrA/exec"
};
// =============================================================

const ORDEM_DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];

// Lê CSV (aceita vírgula ou ponto e vírgula, aspas e arquivo salvo pelo Excel)
function lerCSV(texto) {
  texto = texto.replace(/^﻿/, "");                       // tira marca invisível do Excel
  const primeira = texto.split(/\r?\n/)[0] || "";
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ";" : ",";

  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some(x => x.trim() !== "")) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some(x => x.trim() !== "")) linhas.push(linha);

  const [cab, ...dados] = linhas;
  const chaves = cab.map(chave);
  return dados.map(l => Object.fromEntries(chaves.map((k, i) => [k, (l[i] || "").trim()])));
}

// Normaliza nome de coluna: "Horário " -> "horario"
function chave(k) {
  return String(k).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Converte a resposta JSON do Apps Script em linhas {culto, dia, horario...}
function lerJSON(dados) {
  // aceita [..], {data:[..]}, {dados:[..]}, {values:[..]} ou qualquer objeto que tenha uma lista dentro
  if (!Array.isArray(dados)) {
    const lista = Object.values(dados).find(v => Array.isArray(v));
    dados = lista || [];
  }
  if (!dados.length) return [];

  // lista de listas: a primeira linha são os títulos
  if (Array.isArray(dados[0])) {
    const cab = dados[0].map(chave);
    dados = dados.slice(1).map(l => Object.fromEntries(cab.map((k, i) => [k, l[i]])));
  }

  return dados.map(obj => {
    const linha = {};
    Object.keys(obj).forEach(k => {
      let v = obj[k];
      if (Array.isArray(v)) v = v.join("\n");
      linha[chave(k)] = v == null ? "" : String(v).trim();
    });
    if (!linha.horario && (linha.horarios || linha.hora)) linha.horario = linha.horarios || linha.hora;
    return linha;
  });
}

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}

// Pega o primeiro horário do texto ("9:00 às 11:30" -> 540) para ordenar certo
function minutos(texto) {
  const m = /(\d{1,2})\s*[:h]\s*(\d{2})?/i.exec(texto || "");
  return m ? parseInt(m[1], 10) * 60 + (parseInt(m[2], 10) || 0) : 0;
}

function indiceDia(dia) {
  const palavra = String(dia || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().split(/[\s-]/)[0];
  const i = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"].indexOf(palavra);
  return i < 0 ? 99 : i;
}

// Junta as linhas do mesmo dia + culto num cartão só
function mostrar(linhas) {
  const grupos = new Map();
  linhas.forEach(l => {
    // se as colunas "dia" e "culto" estiverem trocadas na planilha, desfaz a troca
    if (indiceDia(l.dia) === 99 && indiceDia(l.culto) !== 99) {
      [l.dia, l.culto] = [l.culto, l.dia];
    }
    // monta a lista de horários desta linha
    let horas = [];
    const horarioTexto = l.horario || l.horarios || "";
    if (horarioTexto) {
      horas = horarioTexto.split(/\r?\n|;/).map(t => t.trim()).filter(Boolean);
    } else if (l.inicio) {
      horas = [l.inicio + (l.fim ? " às " + l.fim : "")];
    }
    if (!l.dia || !l.culto || !horas.length) return;

    const chave = l.dia.toLowerCase() + "|" + l.culto.toLowerCase();
    if (!grupos.has(chave)) grupos.set(chave, { dia: l.dia, culto: l.culto, obs: "", horas: [] });
    const g = grupos.get(chave);
    g.horas.push(...horas);
    if (l.observacao) g.obs = l.observacao;
  });

  const lista = [...grupos.values()];
  lista.forEach(g => g.horas.sort((a, b) => minutos(a) - minutos(b)));
  lista.sort((a, b) =>
    indiceDia(a.dia) - indiceDia(b.dia) || minutos(a.horas[0]) - minutos(b.horas[0]));

  const alvo = document.getElementById("horarios");
  if (!lista.length) {
    const cols = linhas.length ? Object.keys(linhas[0]).join(", ") : "nenhuma linha recebida";
    alvo.innerHTML = '<p class="aviso">Nenhum horário encontrado.<br><small>Colunas recebidas: ' + esc(cols) +
      '<br>O site precisa de: culto, dia, horario</small></p>';
    return;
  }

  const hoje = new Date().getDay();
  mostrarProximo(lista);

  // agrupa por dia da semana
  const porDia = new Map();
  lista.forEach(g => {
    const k = g.dia.toLowerCase();
    if (!porDia.has(k)) porDia.set(k, { dia: g.dia, cultos: [] });
    porDia.get(k).cultos.push(g);
  });
  const dias = [...porDia.values()].sort((a, b) => indiceDia(a.dia) - indiceDia(b.dia));

  alvo.innerHTML = dias.map(d => {
    const ehHoje = indiceDia(d.dia) === hoje;
    const sigla = d.dia.slice(0, 3).toUpperCase();
    return `
    <article class="dia${ehHoje ? " hoje" : ""}">
      <div class="dia-topo">
        <span class="sigla">${esc(sigla)}</span>
        <h3>${esc(d.dia)}</h3>
        ${ehHoje ? '<span class="tag-hoje">Hoje</span>' : ""}
      </div>
      ${d.cultos.map(c => `
      <div class="culto">
        <p class="nome">${esc(c.culto)}</p>
        <div class="chips">${c.horas.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
        ${c.obs ? `<p class="obs">${esc(c.obs)}</p>` : ""}
      </div>`).join("")}
    </article>`;
  }).join("");
}

// Mostra o próximo culto em destaque, no topo
function mostrarProximo(lista) {
  const agora = new Date();
  let melhor = null;
  lista.forEach(g => {
    const di = indiceDia(g.dia);
    if (di === 99) return;
    g.horas.forEach(t => {
      const alvo = new Date(agora);
      alvo.setHours(0, 0, 0, 0);
      alvo.setDate(alvo.getDate() + ((di - agora.getDay() + 7) % 7));
      alvo.setMinutes(minutos(t));
      if (alvo <= agora) alvo.setDate(alvo.getDate() + 7);
      if (!melhor || alvo < melhor.quando) melhor = { g, t, quando: alvo };
    });
  });
  const box = document.getElementById("destaque");
  if (!melhor) { box.innerHTML = ""; return; }

  const zero = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dias = Math.round((zero(melhor.quando) - zero(agora)) / 86400000);
  const quando = dias === 0 ? "Hoje" : dias === 1 ? "Amanhã" : "Em " + dias + " dias";

  box.innerHTML = `
    <div class="proximo">
      <span class="rotulo">Próximo culto</span>
      <p class="proximo-nome">${esc(melhor.g.culto)}</p>
      <p class="proximo-info">${esc(melhor.g.dia)} · ${esc(melhor.t)}</p>
      <span class="proximo-quando">${quando}</span>
    </div>`;
}

async function carregar() {
  document.getElementById("nome-igreja").textContent = CONFIG.nomeIgreja;
  document.title = "Horários - " + CONFIG.nomeIgreja;
  document.getElementById("endereco").textContent = CONFIG.endereco;
  document.getElementById("link-mapa").href = CONFIG.linkMapa;
  document.getElementById("link-whatsapp").href = "https://wa.me/" + CONFIG.whatsapp;

  const url = CONFIG.urlPlanilha || "horarios.csv";
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error("Não achei o arquivo " + url + " (erro " + resp.status + ")");
    const texto = await resp.text();
    let linhas;
    try { linhas = lerJSON(JSON.parse(texto)); }     // Apps Script (JSON)
    catch (_) { linhas = lerCSV(texto); }            // planilha publicada (CSV)
    mostrar(linhas);
  } catch (e) {
    console.error(e);
    document.getElementById("horarios").innerHTML =
      '<p class="aviso">Não foi possível carregar os horários.<br><small>' + esc(e.message) +
      '<br>Dica: abra o site pelo Live Server, não com duplo clique no arquivo.</small></p>';
  }
}
carregar();