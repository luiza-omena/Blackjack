const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const compression = require("compression");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(compression());

const games = {};
const gameTimers = {};

function createDeck() {
  const ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  const suits = ["S", "H", "D", "C"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ r, s });
  return deck.sort(() => Math.random() - 0.5);
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

function settlePoints(game) {
  const dealerScore = handValue(game.dealer.hand);
  game.dealer.value = dealerScore;
  game.players.forEach((p) => {
    const ps = handValue(p.hand);
    if (ps <= 21 && (dealerScore > 21 || ps > dealerScore)) {
      p.points += 10;
    } else {
      game.dealer.points += 10;
    }
  });
}

async function dealerLogic(game) {
  game.dealerPlaying = true;
  game.dealer.hand[0].hidden = false;
  game.lastUpdate = Date.now();
  await delay(4000);

  while (true) {
    const v = handValue(game.dealer.hand);

    if (v < 17 || (v < 21 && Math.random() < 0.5)) {
      game.dealer.hand.push(game.deck.pop());
      game.dealer.value = handValue(game.dealer.hand);
      game.lastUpdate = Date.now();
      await delay(4000);
      continue;
    }

    break;
  }

  game.dealerPlaying = false;
  settlePoints(game);
  game.lastUpdate = Date.now();
  advanceRound(game);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startPlayerTurnTimer(game) {
  if (game.finished || !game.started || game.dealerPlaying) return;

  if (gameTimers[game.gameId]) {
    clearTimeout(gameTimers[game.gameId]);
  }

  game.timer = game.timer || 15;
  game.timerStart = Date.now();

  gameTimers[game.gameId] = setTimeout(() => {
    if (game.dealerPlaying) return;

    game.currentPlayerIndex++;
    if (game.currentPlayerIndex >= game.players.length) {
      dealerLogic(game);
    } else {
      game.turn = game.players[game.currentPlayerIndex].name;
      startPlayerTurnTimer(game);
    }
    game.lastUpdate = Date.now();
  }, game.timer * 1000);
}

function advanceRound(game) {
  if (gameTimers[game.gameId]) {
    clearTimeout(gameTimers[game.gameId]);
    delete gameTimers[game.gameId];
  }

  if (game.currentRound >= game.totalRounds) {
    game.finished = true;
    const maxPts = Math.max(...game.players.map((p) => p.points));
    game.winner = game.players
      .filter((p) => p.points === maxPts)
      .map((p) => p.name);
    game.started = false;
    game.lastUpdate = Date.now();
  } else {
    game.currentRound++;
    game.currentPlayerIndex = 0;
    game.deck = createDeck();

    game.players.forEach((p) => {
      p.hand = [game.deck.pop(), game.deck.pop()];
      p.value = handValue(p.hand);
    });

    const dealerCard1 = game.deck.pop();
    dealerCard1.hidden = true;
    game.dealer.hand = [dealerCard1, game.deck.pop()];
    game.dealer.value = handValue([game.dealer.hand[1]]);
    game.turn = game.players[0].name;

    startPlayerTurnTimer(game);
    game.lastUpdate = Date.now();
  }
}

app.post("/games", (req, res) => {
  const { playerName, maxPlayers, rounds, timeout } = req.body;
  const gameId = uuidv4(),
    pid = uuidv4();
  games[gameId] = {
    gameId,
    maxPlayers,
    totalRounds: rounds,
    currentRound: 0,
    currentPlayerIndex: 0,
    players: [{ id: pid, name: playerName, hand: [], points: 0, value: 0 }],
    dealer: { hand: [], points: 0, value: 0, name: "Banca" },
    deck: [],
    started: false,
    countdown: false,
    turn: null,
    finished: false,
    winner: null,
    timer: timeout || 15,
    lastUpdate: Date.now(),
    dealerPlaying: false,
    hostId: pid,
  };
  res.json({ gameId, playerId: pid });
});

app.post("/games/random/join", (req, res) => {
  const { playerName } = req.body;
  if (!playerName)
    return res.status(400).json({ error: "Nome é obrigatório." });

  const openGame = Object.values(games).find(
    (g) => !g.started && !g.countdown && g.players.length < g.maxPlayers
  );
  if (!openGame) {
    return res
      .status(404)
      .json({ error: "Nenhuma sala disponível no momento." });
  }

  const pid = uuidv4();
  openGame.players.push({
    id: pid,
    name: playerName,
    hand: [],
    points: 0,
    value: 0,
  });
  openGame.lastUpdate = Date.now();
  return res.json({ playerId: pid, gameId: openGame.gameId });
});

app.post("/games/:gameId/restart", (req, res) => {
  const { gameId } = req.params;
  const game = games[gameId];

  if (!game) return res.status(404).json({ error: "Jogo não encontrado" });

  game.started = false;
  game.finished = false;
  game.countdown = false;
  game.turnIndex = 0;
  game.currentRound = 1;
  game.winner = [];
  game.dealerPlaying = false;
  game.timerStart = null;

  game.players.forEach((p) => {
    p.hand = [];
    p.value = 0;
    p.standing = false;
    p.busted = false;
  });

  game.dealer.hand = [];
  game.dealer.value = 0;

  res.json({ message: "Jogo reiniciado" });
});

app.post("/games/:id/join", (req, res) => {
  const { playerName } = req.body;
  const game = games[req.params.id];
  if (!game) return res.status(404).json({ error: "Sala não encontrada." });
  if (game.started || game.countdown)
    return res.status(400).json({ error: "O jogo já começou." });
  if (game.players.length >= game.maxPlayers)
    return res
      .status(403)
      .json({ error: "Sala cheia. Tente outra ou crie uma nova." });

  const pid = uuidv4();
  game.players.push({
    id: pid,
    name: playerName,
    hand: [],
    points: 0,
    value: 0,
  });
  game.lastUpdate = Date.now();
  res.json({ playerId: pid });
});

app.post("/games/:id/leave", (req, res) => {
  const { playerId } = req.body;
  const game = games[req.params.id];
  if (!game) return res.status(404).json({ error: "Sala não encontrada." });

  const idx = game.players.findIndex((p) => p.id === playerId);
  if (idx === -1)
    return res.status(400).json({ error: "Jogador não encontrado na sala." });

  const isHost = game.players[idx].id === game.hostId;
  game.players.splice(idx, 1);
  game.lastUpdate = Date.now();

  if (isHost || game.players.length === 0) {
    delete games[req.params.id];
    delete gameTimers[req.params.id];
  }

  res.json({ success: true });
});

app.post("/games/:id/start", (req, res) => {
  const game = games[req.params.id];
  if (!game || game.started || game.countdown) return res.status(400).end();
  if (game.players.length < game.maxPlayers) {
    return res.status(400).json({ error: "Aguardando jogadores" });
  }
  game.countdown = true;
  game.lastUpdate = Date.now();

  setTimeout(() => {
    game.countdown = false;
    game.started = true;
    game.currentRound = 1;
    game.deck = createDeck();

    game.players.forEach((p) => {
      p.hand = [game.deck.pop(), game.deck.pop()];
      p.value = handValue(p.hand);
    });

    const dealerCard1 = game.deck.pop();
    dealerCard1.hidden = true;
    game.dealer.hand = [dealerCard1, game.deck.pop()];
    game.dealer.value = handValue([game.dealer.hand[1]]);
    game.turn = game.players[0].name;
    game.lastUpdate = Date.now();

    startPlayerTurnTimer(game);
  }, 3000);

  res.json({ success: true });
});

app.post("/games/:id/hit", (req, res) => {
  const { playerId } = req.body;
  const game = games[req.params.id];
  if (!game || !game.started || game.finished || game.dealerPlaying)
    return res.status(400).end();

  const p = game.players[game.currentPlayerIndex];
  if (p.id !== playerId) return res.status(403).end();

  p.hand.push(game.deck.pop());
  p.value = handValue(p.hand);
  game.lastUpdate = Date.now();

  if (gameTimers[game.gameId]) clearTimeout(gameTimers[game.gameId]);

  if (p.value > 21) {
    game.currentPlayerIndex++;
    if (game.currentPlayerIndex >= game.players.length) {
      dealerLogic(game);
    } else {
      game.turn = game.players[game.currentPlayerIndex].name;
      startPlayerTurnTimer(game);
    }
  } else {
    startPlayerTurnTimer(game);
  }

  res.json({ success: true, timer: game.timer });
});

app.post("/games/:id/stand", (req, res) => {
  const { playerId } = req.body;
  const game = games[req.params.id];
  if (!game || !game.started || game.finished || game.dealerPlaying)
    return res.status(400).end();

  const p = game.players[game.currentPlayerIndex];
  if (p.id !== playerId) return res.status(403).end();

  if (gameTimers[game.gameId]) clearTimeout(gameTimers[game.gameId]);

  game.currentPlayerIndex++;
  if (game.currentPlayerIndex >= game.players.length) {
    dealerLogic(game);
  } else {
    game.turn = game.players[game.currentPlayerIndex].name;
    startPlayerTurnTimer(game);
  }
  game.lastUpdate = Date.now();

  res.json({ success: true, timer: game.timer });
});

app.get("/games/:id", (req, res) => {
  const g = games[req.params.id];
  if (!g) return res.status(404).end();

  const clientLast = parseInt(req.query.last) || 0;
  if (clientLast >= g.lastUpdate) return res.status(304).end();

  const etag = `W/"${g.lastUpdate}"`;
  res.set("ETag", etag);
  if (req.headers["if-none-match"] === etag) return res.status(304).end();

  const dealerData = {
    ...g.dealer,
    hand: g.dealer.hand.map((card, i) =>
      i === 0 && !card.hidden && g.started && !g.finished && !g.dealerPlaying
        ? { ...card, hidden: true }
        : card
    ),
  };

  res.json({
    started: g.started,
    countdown: g.countdown,
    turn: g.turn,
    timer: g.timer,
    timerStart: g.timerStart,
    players: g.players,
    dealer: dealerData,
    finished: g.finished,
    winner: g.winner,
    maxPlayers: g.maxPlayers,
    currentRound: g.currentRound,
    totalRounds: g.totalRounds,
    lastUpdate: g.lastUpdate,
    dealerPlaying: g.dealerPlaying,
  });
});

app.listen(port, () =>
  console.log(`Servidor rodando em http://localhost:${port}`)
);
