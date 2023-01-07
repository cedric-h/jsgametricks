// vim: sw=2 ts=2 expandtab smartindent ft=javascript
const SPLITSCREEN = true;
const BROWSER_HOST = true;
const BROWSER = (typeof window) == "object";
const NODE = !BROWSER;

const SECOND_IN_TICKS = 60; 

/* vektorr maffz */
function lerp(v0, v1, t) { return (1 - t) * v0 + t * v1; }
function lerp_rads(a, b, t) {
  const fmodf = (l, r) => l % r;
  const difference = fmodf(b - a, Math.PI*2.0),
        distance = fmodf(2.0 * difference, Math.PI*2.0) - difference;
  return a + distance * t;
}
function rad_distance(a, b) {
  const fmodf = (l, r) => l % r;
  const difference = fmodf(b - a, Math.PI*2.0),
        distance = fmodf(2.0 * difference, Math.PI*2.0) - difference;
  return distance;
}
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

        state.particles.push({
          id: state.idgen++,

          x: player.x,
          y: player.y,
          death_tick: state.tick + SECOND_IN_TICKS*10,

          vx: d.x,
          vy: d.y,
        });
      }

      if (type == "move" && BROWSER_HOST) {
        /* uh you can't do this before you're spawned in */
        if (!(sender_id in state.players)) continue;
        const player = state.players[sender_id];

        const { x, y } = norm(payload);

        player.vx = x;
        player.vy = y;
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
            vx: 0.0,
            vy: 0.0,
            id: state.id_gen++
          };
      }

      for (const p_id in state.players) {
        const p = state.players[p_id];
        p.x += p.vx * 0.003;
        p.y += p.vy * 0.003;
      }

      /* discard the fields we don't want to send them */
      const { tick } = state;
      const particles = state
        .particles
        .map(({ id, x, y, death_tick }) => ({ id, x, y, death_tick }));
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

  /* setInterval is known to drift and be sloppy
   * this eats more CPU cycles, but it gives a more reliable tick */
  const setTick = (ms, logic) => {
    const start = performance.now();
    let tick = 0;
    (function step() {
      setTimeout(step, 0);

      while ((performance.now() - start) / ms > tick)
        logic(tick++);
    })();
  }

  setTick(1000/60, () => {
    host_tick();

    let msg;
    for (const id in clients)
      while (msg = recv_from_host(id)) {
        if (clients[id].readyState === ws.OPEN)
          clients[id].send(msg);
      }
  });
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
    cam: { x: 0, y: 0 },
    keysdown: {},
    world: default_world(),
    last_world: default_world(),
  });

  return {
    p1: default_player(),
    p2: SPLITSCREEN ? default_player() : undefined,
    last_clicked: 'p1',
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

let last, host_tick_accumulator = 0;
if (BROWSER) window.onload = function frame(elapsed) {
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

    client(p1, elapsed, state.p1);
    client(p2, elapsed, state.p2);

    window.onmousedown = e => {
      const state = client_state();
      if (e.target == p1) state.last_clicked = 'p1';
      if (e.target == p2) state.last_clicked = 'p2';
      dev_cache_state(state);
    };
    window.onkeydown = e => {
      const state = client_state();
      if (state.last_clicked == 'p1') p1.onkeydown(state.p1, e);
      if (state.last_clicked == 'p2') p2.onkeydown(state.p2, e);
      dev_cache_state(state);
    }
    window.onkeyup = e => {
      const state = client_state();
      if (state.last_clicked == 'p1') p1.onkeyup(state.p1, e);
      if (state.last_clicked == 'p2') p2.onkeyup(state.p2, e);
      dev_cache_state(state);
    }
  } else {
    const p1 = document.getElementById("player1");
    p1.width  = window.innerWidth;
    p1.height = window.innerHeight;
    client(p1, elapsed, state.p1);
  }
  dev_cache_state(state);

  if (BROWSER_HOST) {
    /* we want to make sure there's always 1 tick every 60hz,
     * even if e.g. the renderer is lagging.
     *
     * (this makes the speed of objects uniform) */

    if (isFinite(elapsed) && isFinite(last))
      host_tick_accumulator += elapsed - last;
    last = elapsed;

    while (host_tick_accumulator > 1000/60) {
      host_tick_accumulator -= 1000/60;
      host_tick();
    }
  }
  else
    /* it's just used for sending websockets messages,
     * doesn't really matter how often we call it */
    host_tick();
}

function client(canvas, elapsed, state) {
  const id = state.id;

  /* send messages to server */
  canvas.onmousedown = ({ offsetX: x, offsetY: y }) => {
    x /= canvas.width;
    y /= canvas.width;
    x += state.cam.x;
    y += state.cam.y;
    send_host(id, JSON.stringify(["shoot_at", { x, y }]));
  }

  /* using virtual keycodes makes it so that WASD still works
   * even if you use colemak or dvorak etc. */
  canvas.onkeyup = (state, e) => {
    state.keysdown[e.code] = 0;
  }
  canvas.onkeydown = (state, e) => {
    state.keysdown[e.code] = 1;

    if (e.code == 'Escape')
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

  const move = { x: 0, y: 0 };
  if (state.keysdown.KeyW) move.y -= 1;
  if (state.keysdown.KeyS) move.y += 1;
  if (state.keysdown.KeyA) move.x -= 1;
  if (state.keysdown.KeyD) move.x += 1;
  send_host(id, JSON.stringify(["move", norm(move)]));


  render(canvas, elapsed, state);
}

const spritesheet = new Image();
spritesheet.src = "art.png";
function render(canvas, elapsed, state) {
  let dt = 0;
  if (state.last_render != undefined) dt = elapsed - state.last_render;
  state.last_render = elapsed;

  const { world, last_world, cam } = state;

  /* initialize canvas */
  const ctx = canvas.getContext("2d");

  /* clear canvas */
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  /* lerp camera */
  {
    const me = world.players.find(x => x.id == world.you);
    if (me) {
      const ideal_cam_x = me.x - 0.5;
      const ideal_cam_y = me.y - (canvas.height/canvas.width)*0.5;
      cam.x = lerp(cam.x, ideal_cam_x, 0.08);
      cam.y = lerp(cam.y, ideal_cam_y, 0.08);
    }
  }

  ctx.save(); {
    /* make the window wider, it'll zoom.
     * make the window longer, it'll just show more.
     *
     * also, instead of pixels the units are now "screen widths" */
    ctx.scale(canvas.width, canvas.width);

    ctx.translate(-cam.x, -cam.y);

    /* fill in background */
    ctx.fillStyle = "snow";
    ctx.fillRect(0, 0, 1, 1);

    /* idk, let's have 22 tiles on the screen? */
    const TILE_SIZE = 1/22;

    const TILE_PLAYERS = [
      { body: { w: 1, h: 1, x: 0, y: 8 },
        hand: { w: 1, h: 1, x: 1, y: 8 } },
      { body: { w: 1, h: 1, x: 2, y: 8 },
        hand: { w: 1, h: 1, x: 3, y: 8 } },
    ];
    const TILE_SPEAR   = { w: 1, h: 1, x: 4, y: 9 };

    const draw_tile = (tile, dx, dy, dsize, angle) => {
      const TILE_PIXELS = spritesheet.height/11;

      if (angle != undefined) {
        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(angle);
        ctx.drawImage(
          spritesheet,

          /* source x & y on spritesheet */
          tile.x*TILE_PIXELS, tile.y*TILE_PIXELS,
          /* source width and height on spritesheet */
          tile.w*TILE_PIXELS, tile.h*TILE_PIXELS,

          /* destination x & y in world */
          - dsize/2, - dsize/2,
          /* destination width and height in world */
          dsize, dsize
        );
        ctx.restore();
        return;
      }

      ctx.drawImage(
        spritesheet,

        /* source x & y on spritesheet */
        tile.x*TILE_PIXELS, tile.y*TILE_PIXELS,
        /* source width and height on spritesheet */
        tile.w*TILE_PIXELS, tile.h*TILE_PIXELS,

        /* destination x & y in world */
        dx - dsize/2, dy - dsize/2,
        /* destination width and height in world */
        dsize, dsize
      );
    }

    for (const p of world.players) {
      const { id, x, y } = p;

      const { body, hand } = TILE_PLAYERS[(id == world.you) ? 1 : 0];

      const last_pos = last_world.players.find(x => x.id == id);
      if (!last_pos) continue;
      const d = { x: x - last_pos.x, y: y - last_pos.y };

      if (last_pos.angle == undefined) last_pos.angle = 0;
      if (last_pos.damp  == undefined) last_pos.damp  = 0;

      const ideal_damp = (mag(d.x, d.y) > 0) ? 1 : 0;
      const delta = ideal_damp - last_pos.damp;
      last_pos.damp += Math.sign(delta) * Math.min(Math.abs(delta), dt*0.004);
      const damp = last_pos.damp;
      p.damp = damp;

      /* intentional, want perp (also fuck atan2's function signature) */
      const ideal_angle = (mag(d.x, d.y) > 0)
        ? Math.atan2( -d.x , d.y)
        : last_pos.angle;

      const distance = rad_distance(last_pos.angle, ideal_angle);
      const force = Math.min(dt*0.007, Math.abs(distance));
      let angle = last_pos.angle + force*Math.sign(distance);
      p.angle = angle;

      const jog     = Math.cos(elapsed*0.01    )*0.2*damp;
      const headjog = Math.cos(elapsed*0.01*0.5)*0.2*damp;
      angle += jog;

      const hand_space = TILE_SIZE * 0.58;
      const ox = hand_space*Math.cos(angle) + d.x*jog*8;
      const oy = hand_space*Math.sin(angle) + d.y*jog*8;

      draw_tile(body, x + d.x*headjog*3,
                      y + d.y*headjog*3, TILE_SIZE);
      draw_tile(hand, x + ox,
                      y + oy, TILE_SIZE);
      draw_tile(hand, x - ox,
                      y - oy, TILE_SIZE);
    }
    for (const { x, y, death_tick, id } of world.particles) {
      /* canvas treats alphas > 1 the same as 1 */
      const ttl = death_tick - world.tick;
      ctx.globalAlpha = ttl / SECOND_IN_TICKS/2;

      const last_pos = last_world.particles.find(x => x.id == id);
      if (!last_pos) continue;
      const angle = Math.atan2(y - last_pos.y, x - last_pos.x);

      draw_tile(TILE_SPEAR, x, y, TILE_SIZE, angle + Math.PI/2);

      /* bad things happen if you forget to reset this */
      ctx.globalAlpha = 1.0;
    }

  }; ctx.restore();
}
