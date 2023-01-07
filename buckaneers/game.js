// vim: sw=2 ts=2 expandtab smartindent ft=javascript
const SPLITSCREEN = true;
const BROWSER_HOST = true;
const BROWSER = (typeof window) == "object";
const NODE = !BROWSER;

const SECOND_IN_TICKS = 60; 

/* vektorr maffz */
function mag(x, y) { return Math.sqrt(x*x + y*y); }
function norm(obj) {
  const m = mag(obj.x, obj.y);
  if (m > 0.0)
    obj.x /= m,
    obj.y /= m;
  return obj;
}

let host_tick, send_host, recv_from_host;
if ((BROWSER && BROWSER_HOST) || NODE) {

  const default_state = () => {
    const ret = {
      tick: 0,

      /* players are separate from their mailboxes,
       * because we can start sending you networking messages
       * before you're actually moving around in the game
       * in short: client/mailbox = networking, player = ent in game */
      mailbox: [],
      client_mailboxes: {},

      /* ids are important so clients can track entities across frames,
       * allowing them to smooth out their movement across sparse updates
       * (aka interpolation) */
      id_gen: 0,
      particles: [],
      players: {},
    };
    return ret;
  };

  /* make state persist across code-reloads in browser */
  let host_state, dev_cache_state;
  if (NODE) {
    const state_obj = default_state();
    host_state = () => state_obj;
    dev_cache_state = () => {};
  }
  if (BROWSER) {
    const LS = window.localStorage;
    const key = "host_state";

    host_state = () => {
      /* fetch state from local storage */
      let state = JSON.parse(LS.getItem(key));

      /* nothing in the storage: this is the first run */
      if (state == null) state = default_state();

      return state;
    }
    dev_cache_state = state => LS.setItem(key, JSON.stringify(state));
  }

  send_host = (sender_id, msg) => {
    const state = host_state();
    state.mailbox.unshift({ sender_id, msg });
    dev_cache_state(state);
  }
  
  recv_from_host = (sender_id) => {
    const state = host_state();

    /* we won't have messages for a client we've never heard of */
    if (!(sender_id in state.client_mailboxes))
      /* but we will register you for later */
      state.client_mailboxes[sender_id] = [];

    const mailbox = state.client_mailboxes[sender_id];

    /* nothing to see here */
    if (mailbox.length == 0) {
      dev_cache_state(state);
      return 0;
    }

    const ret = mailbox.pop();

    dev_cache_state(state);
    return ret;
  }

  host_tick = () => {
    let state = host_state();

    while (state.mailbox.length > 0) {
      const { sender_id, msg } = state.mailbox.pop();

      /* you're not in our records, you must be new */
      if (!(sender_id in state.client_mailboxes))
        state.client_mailboxes[sender_id] = [];

      const [type, payload] = JSON.parse(msg);

      if (type == "shoot_at") {
        /* uh you can't do this before you're spawned in */
        if (!(sender_id in state.players)) continue;
        const player = state.players[sender_id];

        const { x, y } = payload;

        const d = norm({ x: x - player.x,
                         y: y - player.y });

        player.x += d.x * 0.03;
        player.y += d.y * 0.03;

        state.particles.push({
          id: state.idgen++,

          x: player.x,
          y: player.y,
          death_tick: state.tick + SECOND_IN_TICKS*10,

          vx: d.x,
          vy: d.y,
        });
      }

      if (type == "dev_reset" && BROWSER_HOST) {
        state = null;
        dev_cache_state(null);
        window.location.reload();
      }
    }

    {
      /* spawn a player for each client mailbox (if not one already)
       * (if we ever have a spectator mode or char creation screen,
       *  this won't make sense anymore) */
      for (const p_id in state.client_mailboxes) {
        if (!(p_id in state.players))
          state.players[p_id] = {
            x: 0.5,
            y: 0.5,
            id: state.id_gen++
          };
      }

      /* discard the fields we don't want to send them */
      const { tick } = state;
      const particles = state.particles.map(({ id, x, y, death_tick }) => {
        const ttl = death_tick - state.tick;
        return { id, x, y, ttl };
      });
      const players = Object
        .values(state.players)
        .map(({ id, x, y }) => ({ id, x, y }));

      for (const p_id in state.client_mailboxes) {
        const mailbox = state.client_mailboxes[p_id];

        /* maybe confusing, but we're going from
         * "id of client with mailbox" to
         * "id of entity in game they control" */
        const you = state.players[p_id].id;

        mailbox.unshift(JSON.stringify([
          "tick",
          { tick, players, particles, you }
        ]));
      }
    }

    state.tick++;

    // for (const sprink of state.sprinklers) {
    //   /* ten times a second, sprinklers spawn particles */
    //   if ((state.tick % SECOND_IN_TICKS*5) == 0) {
    //     state.particles.push({
    //       id: state.idgen++,

    //       x: sprink.x,
    //       y: sprink.y,
    //       death_tick: state.tick + SECOND_IN_TICKS*10,

    //       /* turn the current tick into an angle,
    //        * and from an angle into a velocity vector. */
    //       vx: Math.cos(state.tick + sprink.x*10),
    //       vy: Math.sin(state.tick + sprink.y*10),
    //     });
    //   }
    // }

    state.particles = state.particles.filter(part => {
      /* should be straight forward */
      part.x += part.vx * 0.003;
      part.y += part.vy * 0.003;

      /* wrap around the edges pacman style */
      if (part.x < 0) part.x = 1 - Math.abs(part.x);
      if (part.x > 1) part.x = part.x - 1;
      if (part.y < 0) part.y = 1 - Math.abs(part.y);
      if (part.y > 1) part.y = part.y - 1;

      return part.death_tick >= state.tick;
    });

    dev_cache_state(state);
  }
} else if (BROWSER) {
  host_tick = () => {};

  /* supports multiple sockets purely for splitscreen */
  send_host      = (id, msg) => socket(id).send_host(msg);
  recv_from_host = (id) => socket(id).recv_from_host();

  let sockets = {};
  function socket(id) {
    if (id in sockets) return sockets[id];

    let ret = sockets[id] = {};

    /* hold in messages until the websocket opens */
    let outbox = [];
    ret.send_host = msg => outbox.unshift(msg);
    ret.recv_from_host = () => 0;

    const ws = new WebSocket("ws://localhost:8080");
    ws.onopen = () => {
      console.log("socket open!");

      for (const msg of outbox) ws.send(msg);
      ret.send_host = msg => ws.send(msg);

      let inbox = [];
      ws.onmessage = (msg) => inbox.unshift(msg.data);
      ret.recv_from_host = () => inbox.length && inbox.pop();
    }

    return ret;
  }
}

if (NODE) {
  const port = 8080;

  const express = require('express');
  const ws = require('ws');
  const app = express();
  app.use(express.static('./'))
  const wss = new ws.Server({ noServer: true });
  const server = app.listen(8080);
  console.log('Listening on port ' + port)
  server.on('upgrade', (...args) => wss.handleUpgrade(...args, connect));

  let id_gen = 0;
  let clients = {};
  function connect(ws) {
    const id = id_gen++;
    console.log("connect! id: " + id);
    clients[id] = ws;

    ws.on('message', (data) => send_host(id, data.toString()));
  }

  setInterval(() => {
    host_tick();

    let msg;
    for (const id in clients)
      while (msg = recv_from_host(id)) {
        if (clients[id].readyState === ws.OPEN)
          clients[id].send(msg);
      }
  }, 1000/50);
}

/* default client state */
const default_state = () => {
  const default_world = () => ({
    players: [],
    particles: [],
    tick: 0
  });
  const default_player = () => ({
    /* could prolly have server assign ids but i dont foresee a collision */
    id: Math.floor(Math.random() * 99999999999),
    world: default_world(),
    last_world: default_world(),
  });

  return {
    p1: default_player(),
    p2: SPLITSCREEN ? default_player() : undefined,
  };
}

/* make state persist across code-reloads when browser-hosting */
/* is there a point to live-reloading code when node hosting? */
let client_state, dev_cache_state;
if (!BROWSER_HOST) {
  const state_obj = default_state();
  client_state = () => state_obj;
  dev_cache_state = () => {};
}
if (BROWSER_HOST) {
  const LS = window.localStorage;
  const key = "client_state";

  client_state = () => {
    /* fetch state from local storage */
    let state = JSON.parse(LS.getItem(key));

    /* nothing in the storage: this is the first run */
    if (state == null) state = default_state();

    return state;
  }
  dev_cache_state = state => LS.setItem(key, JSON.stringify(state));
}
if (BROWSER) window.onload = function frame() {
  requestAnimationFrame(frame);

  const state = client_state();
  if (SPLITSCREEN) {
    const p1 = document.getElementById("player1");
    const p2 = document.getElementById("player2");
    p2.width  = p1.width  = window.innerWidth;
    p2.height = p1.height = window.innerHeight / 2;

    /* fix gap between the two? fuck CSS */
    p2.style.position = 'absolute';
    p2.style.bottom = '0px';
    p2.style.left = '0px';

    client(p1, state.p1);
    client(p2, state.p2);

    window.onkeydown = e => (p1.onkeydown(e), p2.onkeydown(e));
  } else {
    const p1 = document.getElementById("player1");
    p1.width  = window.innerWidth;
    p1.height = window.innerHeight;
    client(p1, state.p1);
  }
  dev_cache_state(state);

  host_tick();
}

function client(canvas, state) {
  const id = state.id;

  /* send messages to server */
  canvas.onmousedown = ({ offsetX: x, offsetY: y }) => {
    x /= canvas.width;
    y /= canvas.width;
    send_host(id, JSON.stringify(["shoot_at", { x, y }]));
  }

  canvas.onkeydown = e => {
    if (e.key == "Escape")
      send_host(id, JSON.stringify(["dev_reset"]));
  };

  /* take messages from server */
  let msg;
  while (msg = recv_from_host(id)) {
    const [type, payload] = JSON.parse(msg);

    if (type == "tick")
      state.last_world = state.world,
      state.world = payload;
  }

  render(canvas, state.world, state.last_world);
}

const spritesheet = new Image();
spritesheet.src = "art.png";
function render(canvas, world, last_world) {
  /* initialize canvas */
  const ctx = canvas.getContext("2d");

  /* clear canvas */
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save(); {
    /* make the window wider, it'll zoom.
     * make the window longer, it'll just show more.
     *
     * also, instead of pixels the units are now "screen widths" */
    ctx.scale(canvas.width, canvas.width);

    /* fill in background */
    ctx.fillStyle = "snow";
    ctx.fillRect(0, 0, 1, 1);

    const TILE_PLAYER  = { w: 1, h: 1, x: 0, y: 8 };
    const TILE_PLAYER0 = { w: 1, h: 1, x: 2, y: 8 };
    const TILE_SPEAR   = { w: 1, h: 1, x: 4, y: 9 };

    const draw_tile = (tile, dx, dy, dsize, angle) => {
      const TILE_SIZE = spritesheet.height/11;

      if (angle != undefined) {
        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(angle);
        ctx.drawImage(
          spritesheet,

          /* source x & y */
          tile.x*TILE_SIZE, tile.y*TILE_SIZE,
          /* source width and height */
          tile.w*TILE_SIZE, tile.h*TILE_SIZE,

          /* destination x & y */
          - dsize/2, - dsize/2,
          /* destination width and height */
          dsize, dsize
        );
        ctx.restore();
        return;
      }

      ctx.drawImage(
        spritesheet,

        /* source x & y */
        tile.x*TILE_SIZE, tile.y*TILE_SIZE,
        /* source width and height */
        tile.w*TILE_SIZE, tile.h*TILE_SIZE,

        /* destination x & y */
        dx - dsize/2, dy - dsize/2,
        /* destination width and height */
        dsize, dsize
      );
    }

    for (const { id, x, y } of world.players) {
      const size = 0.05;

      const tile = id == world.you ? TILE_PLAYER0 : TILE_PLAYER;
      draw_tile(tile, x, y, size);
    }
    for (const { x, y, death_tick, id } of world.particles) {
      const size = 0.05;

      /* canvas treats alphas > 1 the same as 1 */
      const ttl = death_tick - world.tick;
      ctx.globalAlpha = ttl / SECOND_IN_TICKS;

      const last_pos = last_world.particles.find(x => x.id == id);
      if (!last_pos) continue;
      const angle = Math.atan2(y - last_pos.y, x - last_pos.x);

      draw_tile(TILE_SPEAR, x, y, size, angle + Math.PI/2);

      /* bad things happen if you forget to reset this */
      ctx.globalAlpha = 1.0;
    }

  }; ctx.restore();
}
