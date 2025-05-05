const API_URL = "http://localhost:3000";

let playerName = "",
  playerId = "",
  gameId = "",
  isHost = false;
let pollingInterval = 800,
  lastUpdate = 0,
  isMyTurn = false;
let timerInt = null,
  lastTurn = null,
  sawCountdown = false;
let dealerPlaying = false,
  gameFinished = false;
let lastDealerPlaying = false;
let lastDealerHandCount = 0;

function show(el) {
  document.getElementById(el).classList.remove("hidden");
}
function hide(el) {
  document.getElementById(el).classList.add("hidden");
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  show("toast");
  setTimeout(() => hide("toast"), 3000);
}

function startCountdownLocal() {
  const cd = document.getElementById("countdown");
  show("countdown");
  let c = 3;
  cd.textContent = c;
  const iv = setInterval(() => {
    c--;
    cd.textContent = c > 0 ? c : "Vai!";
    if (c <= 0) {
      clearInterval(iv);
      setTimeout(() => hide("countdown"), 800);
    }
  }, 1000);
}

function getCardImage(c, hidden = false) {
  if (hidden) return "https://deckofcardsapi.com/static/img/back.png";
  const r = c.r === "10" ? "0" : c.r,
    s = c.s;
  return `https://deckofcardsapi.com/static/img/${r}${s}.png`;
}

function renderPlayers(ps, turn, isDealerPlaying) {
  const cont = document.getElementById("players");
  cont.innerHTML = "";
  ps.forEach((p) => {
    const isCurrent = !isDealerPlaying && p.name === turn;
    const div = document.createElement("div");
    div.className = "hand";
    div.innerHTML = `
      <h2>${p.name}${isCurrent ? " 🔹" : ""}</h2>
      <div class="cards">${p.hand
        .map((c) => `<img src="${getCardImage(c)}" class="card">`)
        .join("")}</div>
      <div class="hand-value">Valor: ${p.value}</div>
    `;
    cont.appendChild(div);
  });
}

function renderDealer(gameState, isDealerPlaying, isGameFinished) {
  const dv = document.getElementById("dealer");
  dv.querySelector(".cards").innerHTML = gameState.hand
    .map(
      (c, i) =>
        `<img src="${getCardImage(
          c,
          i === 0 && !isGameFinished && !isDealerPlaying
        )}" class="card">`
    )
    .join("");

  const valueToShow =
    isDealerPlaying || isGameFinished
      ? gameState.value
      : handValue([gameState.hand[1]]);
  dv.querySelector(".hand-value").textContent = `Valor: ${valueToShow}`;
}

function handValue(hand) {
  let total = 0,
    aces = 0;
  for (const c of hand) {
    if (c.r === "A") {
      total += 11;
      aces++;
    } else if (["K", "Q", "J"].includes(c.r)) total += 10;
    else total += parseInt(c.r, 10);
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}

function updateScoreboard(ps, gameState, turn) {
  const sb = document.getElementById("scoreboard");
  const dealerTurn = gameState.dealerPlaying;

  sb.innerHTML =
    ps
      .map((p) => {
        const isCurrent = !dealerTurn && p.name === turn;
        return `<div${
          isCurrent ? ' style="color:var(--highlight); font-weight:bold;"' : ""
        }>
          ${p.name}${isCurrent ? " 🔹" : ""}: ${p.points} pts
        </div>`;
      })
      .join("") +
    `<div${
      dealerTurn ? ' style="color:var(--highlight); font-weight:bold;"' : ""
    }>
      Banca${dealerTurn ? " 🔹" : ""}: ${gameState.points} pts
    </div>`;

  sb.classList.add("show");
}

function updateTimer(gameState) {
  clearInterval(timerInt);
  const t = document.getElementById("timer");

  if (!gameState || !gameState.timerStart || !gameState.timer) {
    t.textContent = "";
    return;
  }

  if (gameState.dealerPlaying) {
    t.textContent = "⌛ Banca jogando...";
    t.style.color = "#36dba8";
    return;
  }

  const update = () => {
    const elapsed = (Date.now() - gameState.timerStart) / 1000;
    const remaining = Math.max(0, Math.ceil(gameState.timer - elapsed));
    t.textContent = `⏳ ${remaining}s`;
    t.style.color = remaining <= 5 ? "#ff5555" : "#36dba8";
  };

  update();
  timerInt = setInterval(update, 1000);
}

function showWinnerModal(winners) {
  const modal = document.getElementById("modal");
  const message = document.getElementById("modal-message");
  const btn = document.getElementById("modal-btn");

  if (winners.length === 1) {
    message.innerHTML = `<h2>🏆 Vencedor 🏆</h2><p>${winners[0]} ganhou o jogo!</p>`;
  } else {
    message.innerHTML = `<h2>🏆 Empate 🏆</h2><p>${winners.join(
      " e "
    )} empataram!</p>`;
  }

  show("modal");

  btn.onclick = async () => {
    hide("modal");

    try {
      await fetch(`${API_URL}/games/${gameId}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      await fetch(`${API_URL}/games/${gameId}/start`, {
        method: "POST",
      });

      sawCountdown = false;
      lastTurn = null;
      gameFinished = false;
      lastDealerPlaying = false;
      lastDealerHandCount = 0;

      optimizedFetchState();
    } catch (e) {
      toast("Erro ao reiniciar o jogo.");
    }
  };
}

let dealerMsgTimeout;

function showDealerMessage(message, duration = 3000) {
  const dealerActionEl = document.getElementById("dealerAction");

  clearTimeout(dealerMsgTimeout);
  dealerActionEl.innerText = message;
  show("dealerAction");

  dealerMsgTimeout = setTimeout(() => {
    hide("dealerAction");
  }, duration);
}

async function optimizedFetchState() {
  try {
    const res = await fetch(`${API_URL}/games/${gameId}?last=${lastUpdate}`, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (res.status === 304) {
      pollingInterval = Math.min(pollingInterval * 1.5, 2000);
      return;
    }

    const gameState = await res.json();
    dealerPlaying = gameState.dealerPlaying;
    lastUpdate = gameState.lastUpdate || Date.now();
    const dealerActionEl = document.getElementById("dealerAction");

    if (!lastDealerPlaying && gameState.dealerPlaying) {
      showDealerMessage("🎬 A banca começou sua rodada!", 3000);
    }

    if (
      gameState.dealerPlaying &&
      gameState.dealer.hand.length > lastDealerHandCount
    ) {
      showDealerMessage("🃏 A banca comprou uma nova carta...", 2500);
    }

    if (lastDealerPlaying && !gameState.dealerPlaying) {
      showDealerMessage("✅ A banca finalizou sua jogada.", 3000);
    }

    lastDealerPlaying = gameState.dealerPlaying;
    lastDealerHandCount = gameState.dealer.hand.length;

    if (gameState.countdown) {
      if (!sawCountdown) {
        sawCountdown = true;
        startCountdownLocal();
      }
      return;
    }

    if (gameState.finished && !gameFinished) {
      gameFinished = true;
      setTimeout(
        () => showWinnerModal(gameState.winner, gameState.players),
        1200
      );
      return;
    }

    if (!gameState.started) {
      document.getElementById("playerList").innerHTML = `
        <h3>Jogadores (${gameState.players.length}/${
        gameState.maxPlayers
      }):</h3>
        ${gameState.players.map((p) => `<div>${p.name}</div>`).join("")}
      `;
      show("playerList");
      hide("game");
      document.getElementById("startBtn").disabled = !(
        isHost && gameState.players.length === gameState.maxPlayers
      );
      return;
    } else {
      hide("setup");
      hide("playerList");
      hide("rules");
      hide("waitHost");
      show("game");
      show("scoreboard");

      document.getElementById(
        "info"
      ).textContent = `Rodada ${gameState.currentRound}/${gameState.totalRounds}`;
      renderPlayers(gameState.players, gameState.turn, gameState.dealerPlaying);
      renderDealer(
        gameState.dealer,
        gameState.dealerPlaying,
        gameState.finished
      );
      updateScoreboard(gameState.players, gameState.dealer, gameState.turn);
      updateTimer(gameState);
    }

    if (!gameState.finished && gameState.turn !== lastTurn) {
      if (gameState.turn === playerName) {
        show("hitBtn");
        show("standBtn");
        showTurnModal("É a sua vez!");
      } else if (gameState.dealerPlaying) {
        hide("hitBtn");
        hide("standBtn");
        showTurnModal("Agora é a vez da banca!");
      } else {
        hide("hitBtn");
        hide("standBtn");
        showTurnModal(`É a vez de ${gameState.turn}`);
      }

      lastTurn = gameState.turn;
    }

    dealerPlaying = gameState.dealerPlaying;

    pollingInterval = gameState.dealerPlaying ? 500 : 800;
  } catch (error) {
    pollingInterval = Math.min(pollingInterval * 2, 5000);
  } finally {
    setTimeout(optimizedFetchState, pollingInterval);
  }
}

function showTurnModal(reason) {
  const modal = document.getElementById("turnModal");
  modal.querySelector("#turnMessage").innerHTML = `
    <h3>${reason}</h3>
    <div class="timer-pulse">⏳</div>
  `;
  show("turnModal");
  setTimeout(() => hide("turnModal"), 2000);
}

async function safeFetch(url, options, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

document.getElementById("createGameBtn").onclick = async () => {
  playerName = document.getElementById("playerName").value.trim();
  const maxP = +document.getElementById("maxPlayers").value,
    rounds = +document.getElementById("rounds").value,
    to = +document.getElementById("timeout").value;

  if (!playerName) {
    return toast("Digite seu nome para criar a sala.");
  }
  if (maxP < 2) {
    return toast("A sala deve ter no mínimo 2 jogadores.");
  }
  if (rounds < 3) {
    return toast("O jogo deve ter pelo menos 3 rodadas.");
  }
  if (to < 5) {
    return toast("O tempo por turno deve ser de no mínimo 5 segundos.");
  }

  try {
    const res = await fetch(`${API_URL}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerName,
        maxPlayers: maxP,
        rounds,
        timeout: to,
      }),
    });
    const data = await res.json();

    gameId = data.gameId;
    playerId = data.playerId;
    isHost = true;

    document.getElementById("gameIdText").textContent = `Sala: ${gameId}`;
    show("gameIdDisplay");
    show("startBtn");
    show("leaveRoomBtn");
    hide("formContainer");
    optimizedFetchState();
  } catch (e) {
    toast(
      "Não foi possível criar a sala. Verifique sua conexão e tente novamente."
    );
  }
};

document.getElementById("joinRandomBtn").onclick = async () => {
  playerName = document.getElementById("playerNameJoin").value.trim();
  isHost = false;

  if (!playerName) {
    return toast("Digite seu nome antes de procurar uma sala.");
  }

  try {
    const res = await fetch(`${API_URL}/games/random/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return toast(data.error || "Erro ao procurar uma sala.");
    }

    gameId = data.gameId;
    playerId = data.playerId;

    document.getElementById("gameIdText").textContent = `Sala: ${gameId}`;
    show("gameIdDisplay");
    show("waitHost");
    show("leaveRoomBtn");
    hide("formContainer");
    optimizedFetchState();
  } catch (e) {
    toast("Erro ao entrar em uma sala aleatória. Tente novamente.");
  }
};

document.getElementById("joinGameBtn").onclick = async () => {
  playerName = document.getElementById("playerNameJoin").value.trim();
  isHost = false;
  const inputGameId = document.getElementById("gameIdInput").value.trim();

  if (!playerName) return toast("Digite seu nome para entrar na sala.");
  if (!inputGameId) return toast("Digite o código da sala para entrar.");

  gameId = inputGameId;

  try {
    const res = await fetch(`${API_URL}/games/${gameId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      return toast(data.error || "Erro ao entrar na sala.");
    }

    playerId = data.playerId;

    document.getElementById("gameIdText").textContent = `Sala: ${gameId}`;
    show("gameIdDisplay");
    show("waitHost");
    show("leaveRoomBtn");
    hide("formContainer");
    optimizedFetchState();
  } catch (e) {
    toast("Não foi possível entrar na sala. Verifique o código e sua conexão.");
  }
};

document.getElementById("startBtn").onclick = async () => {
  try {
    await fetch(`${API_URL}/games/${gameId}/start`, { method: "POST" });
    document.getElementById("startBtn").disabled = true;
    optimizedFetchState();
  } catch (e) {
    alert("Erro ao iniciar jogo!");
  }
};

document.getElementById("hitBtn").onclick = () => {
  safeFetch(`${API_URL}/games/${gameId}/hit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  }).catch(() => toast("Falha ao pedir carta"));
};

document.getElementById("standBtn").onclick = () => {
  safeFetch(`${API_URL}/games/${gameId}/stand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  }).catch(() => toast("Falha ao parar"));
};

document.getElementById("leaveRoomBtn").onclick = async () => {
  clearInterval(timerInt);

  try {
    await fetch(`${API_URL}/games/${gameId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
  } catch (e) {
    console.warn("Erro ao sair da sala:", e);
  } finally {
    location.reload();
  }
};

document.getElementById("copyGameIdBtn").onclick = () => {
  const gameId = document
    .getElementById("gameIdText")
    .textContent.replace("Sala: ", "")
    .trim();
  navigator.clipboard
    .writeText(gameId)
    .then(() => {
      toast("ID da sala copiado!");
    })
    .catch(() => {
      toast("Erro ao copiar o ID.");
    });
};

hide("game");
hide("scoreboard");
hide("startBtn");
hide("leaveRoomBtn");
hide("modal");
