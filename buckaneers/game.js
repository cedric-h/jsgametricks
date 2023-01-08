// vim: sw=2 ts=2 expandtab smartindent ft=javascript
const SPLITSCREEN = true;
const BROWSER_HOST = true;
const BROWSER = (typeof window) == "object";
const NODE = !BROWSER;

const SECOND_IN_TICKS = 60; 
const SPEAR_RELEASE_FWD = 0.04;
const SPEAR_RELEASE_OUT = 0.027;

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

      if (type == "attack") {
        /* uh you can't do this before you're spawned in */
        if (!(sender_id in state.players)) continue;
        const player = state.players[sender_id];

        const { x, y } = payload;
        const d = norm({ x: x - player.x,
                         y: y - player.y });

        player.attack.dx = d.x;
        player.attack.dy = d.y;
        player.attack.tick_msg_latest = state.tick;
        if (player.attack.streak == 'dormant')
          player.attack.streak = 'active',
          player.attack.tick_msg_earliest = state.tick;
      }

      if (type == "move") {
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
            attack: {
              tick_msg_earliest: 0,
              tick_msg_latest: 0,
              tick_cooldown_over: 0,
              streak: 'dormant', // 'dormant' | 'cooldown' | 'active'
              dx: 0,
              dy: 0,
            },
            id: state.id_gen++
          };
      }


      const ATTACK_TIMEOUT = SECOND_IN_TICKS*0.2;
      const ATTACK_PREPARE_DURATION = SECOND_IN_TICKS*0.8;
      for (const p_id in state.players) {
        const p = state.players[p_id];
        p.x += p.vx * 0.003;
        p.y += p.vy * 0.003;


        if (p.attack.streak == 'dormant') continue;
        if (p.attack.streak == 'cooldown') {
          if (state.tick >= p.attack.tick_cooldown_over)
            p.attack.streak = 'dormant';
          continue;
        }

        /* you broke the streak, we're going back to dormant */
        const ticks_since_latest = state.tick - p.attack.tick_msg_latest;
        if (ticks_since_latest >= ATTACK_TIMEOUT)
          // console.log("streak broken by timeout"),
          p.attack.streak = 'dormant';

        /* you waited the full time without breaking the streak, you attack */
        const ticks_since_earliest = state.tick - p.attack.tick_msg_earliest;
        const prog = ticks_since_earliest / ATTACK_PREPARE_DURATION;
        if (prog >= 1) {
          // console.log("streak broken by completion");
          const a = p.attack;

          a.streak = 'cooldown';
          a.tick_cooldown_over = state.tick + 1.5*SECOND_IN_TICKS;

          state.particles.push({
            id: state.idgen++,

            x: p.x + a.dx*SPEAR_RELEASE_FWD - a.dy*SPEAR_RELEASE_OUT,
            y: p.y + a.dy*SPEAR_RELEASE_FWD + a.dx*SPEAR_RELEASE_OUT,
            death_tick: state.tick + SECOND_IN_TICKS*10,

            vx: a.dx,
            vy: a.dy,
          });
        }
      }

      /* discard the fields we don't want to send them */
      const { tick } = state;
      const particles = state
        .particles
        .map(({ id, x, y, death_tick }) => ({ id, x, y, death_tick }));
      const players = Object
        .values(state.players)
        .map(({ id, x, y }) => ({ id, x, y }));

      for (let i = 0; i < players.length; i++) {
        const { attack } = Object.values(state.players)[i];
        const p_msg = players[i];

        if (attack.streak == 'dormant') continue;

        const ticks_since_earliest = state.tick - attack.tick_msg_earliest;
        const prog = ticks_since_earliest / ATTACK_PREPARE_DURATION;
        if (prog >= 0 && prog <= 1.1) {
          p_msg.attack = {
            prog: prog,
            dx: attack.dx,
            dy: attack.dy,
          }
        }
      }

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

    /* input */
    keysdown: {},
    mousedown: false,
    mousepos: false,
    attack_dir: 0.0,
    attack_countdown: 0.0,

    /* data from server */
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

let host_last, last, host_tick_accumulator = 0;
if (BROWSER) window.onload = function frame(elapsed) {
  requestAnimationFrame(frame);

  let dt = 0;
  if (last != undefined) dt = elapsed - last;
  last = elapsed;

  window.onmousedown = e => {
    const state = client_state();
    state.last_clicked = e.target.id;

    client_mouse_event(
      e.target,
      state[state.last_clicked],
      { type: 'mousedown', x: e.offsetX, y: e.offsetY },
    );
    dev_cache_state(state);
  };
  window.onmousemove = e => {
    const state = client_state();
    client_mouse_event(
      document.getElementById(state.last_clicked),
      state[state.last_clicked],
      { type: 'mousemove', x: e.offsetX, y: e.offsetY },
    );
    dev_cache_state(state);
  }
  window.onmouseup = e => {
    const state = client_state();
    client_mouse_event(
      document.getElementById(state.last_clicked),
      state[state.last_clicked],
      { type: 'mouseup', x: e.offsetX, y: e.offsetY },
    );
    dev_cache_state(state);
  }

  const state = client_state();
  if (SPLITSCREEN) {
    const p1 = document.getElementById("p1");
    const p2 = document.getElementById("p2");
    p2.width  = p1.width  = window.innerWidth;
    p2.height = p1.height = window.innerHeight / 2;

    /* fix gap between the two? fuck CSS */
    p2.style.position = 'absolute';
    p2.style.bottom = '0px';
    p2.style.left = '0px';

    client(state.p1, p1, elapsed, dt);
    client(state.p2, p2, elapsed, dt);

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
    const p1 = document.getElementById("p1");
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

    // const bad_fps = 1000/40;
    // const now = Math.floor(elapsed/bad_fps)*bad_fps;
    const now = elapsed;
    if (isFinite(elapsed) && isFinite(host_last))
      host_tick_accumulator += now - host_last;
    host_last = now;

    /* if we owe more than 100 ticks, we're fucked */
    const TICK_MS = 1000/SECOND_IN_TICKS;
    if (host_tick_accumulator/TICK_MS > 100)
      host_tick_accumulator = 0;

    while (host_tick_accumulator > TICK_MS) {
      host_tick_accumulator -= TICK_MS;
      host_tick();
    }
  }
  else
    /* it's just used for sending websockets messages,
     * doesn't really matter how often we call it */
    host_tick();
}

function client_mouse_event(canvas, state, ev) {
  let { type, x, y } = ev;

  /* translate to world coordinates */
  x /= canvas.width;
  y /= canvas.width;
  x += state.cam.x;
  y += state.cam.y;
  state.mousepos = { x, y };

  state.attack_countdown = 0;

  if (type == 'mouseup'  ) state.mousedown = false;
  if (type == 'mousedown') state.mousedown = true;
}

const SPEAR_ROTATE_SPEED = 0.007;
function client(state, canvas, elapsed, dt) {
  client_last = elapsed;

  const id = state.id;

  /* take messages from server */
  const world_b4 = state.world;
  let msg;
  while (msg = recv_from_host(id)) {
    const [type, payload] = JSON.parse(msg);

    if (type == "tick")
      state.world = payload;
  }
  /* some hacks in rendering code rely on monotonically increasing worlds */
  if (state.world != world_b4) state.last_world = world_b4;

  /* send messages to server */
  if (state.mousedown) {
    const player = state.world.players.find(x => x.id == state.world.you);
    const ideal_dir = Math.atan2(state.mousepos.y - player.y,
                                 state.mousepos.x - player.x);
    const distance = rad_distance(state.attack_dir, ideal_dir);
    const force = Math.min(dt*SPEAR_ROTATE_SPEED, Math.abs(distance));
    state.attack_dir += force*Math.sign(distance);

    if (dt > 1.5*(1000/60)) state.attack_dir = ideal_dir;

    state.attack_countdown -= dt;
    if (state.attack_countdown <= 0) {
      state.attack_countdown = 1000/60 * 5;
      send_host(id, JSON.stringify(["attack", {
        x: player.x + Math.cos(state.attack_dir),
        y: player.y + Math.sin(state.attack_dir),
      }]));
    }
  }

  /* using virtual keycodes makes it so that WASD still works
   * even if you use colemak or dvorak etc. */
  canvas.onkeyup = (state, e) => state.keysdown[e.code] = 0;
  canvas.onkeydown = (state, e) => {
    state.keysdown[e.code] = 1;

    if (e.code == 'Escape' && BROWSER_HOST)
      send_host(id, JSON.stringify(["dev_reset"]));
  };

  const move = { x: 0, y: 0 };
  if (state.keysdown.KeyW) move.y -= 1;
  if (state.keysdown.KeyS) move.y += 1;
  if (state.keysdown.KeyA) move.x -= 1;
  if (state.keysdown.KeyD) move.x += 1;
  send_host(id, JSON.stringify(["move", norm(move)]));

  render(state, canvas, elapsed, dt);
}

const spritesheet = new Image();
spritesheet.src = "art.png";
function render(state, canvas, elapsed, dt) {
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
      const { id, x, y, attack } = p;
      
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
      let ideal_angle = (mag(d.x, d.y) > 0)
        ? Math.atan2( -d.x , d.y)
        : last_pos.angle;
      let speed = 0.007;
      if (attack) {
        speed = SPEAR_ROTATE_SPEED;
        ideal_angle = Math.atan2( attack.dx, -attack.dy );
      }

      const distance = rad_distance(last_pos.angle, ideal_angle);
      const force = Math.min(dt*speed, Math.abs(distance));
      let angle = last_pos.angle + force*Math.sign(distance);
      p.angle = angle;

      let hanim_x = 0, hanim_y = 0;
      if (attack) {
        const t = attack.prog;
        let fwd = SPEAR_RELEASE_FWD;
        if (t < 0.8) fwd = lerp(   0, -fwd, t/0.8);
        else         fwd = lerp(-fwd,  fwd, (t - 0.8)/0.2);

        const forw_x = Math.cos(angle);
        const forw_y = Math.sin(angle);
        hanim_x    =  forw_y*t*fwd;
        hanim_y    = -forw_x*t*fwd;
        let anim_x =  forw_y*t*(fwd*0.9);
        let anim_y = -forw_x*t*(fwd*0.9);
        anim_x += forw_x*SPEAR_RELEASE_OUT;
        anim_y += forw_y*SPEAR_RELEASE_OUT;

        if (attack.prog < 1.05)
          draw_tile(TILE_SPEAR, x+anim_x, y+anim_y, TILE_SIZE, angle);

        if (attack.prog > 1) {
          const t = (attack.prog - 1) / 0.1;
          hanim_x *= 1 - t;
          hanim_y *= 1 - t;
        }
      }

      const jog     = Math.cos(elapsed*0.01    )*0.2*damp;
      const headjog = Math.cos(elapsed*0.01*0.5)*0.2*damp;
      if (attack == undefined) angle += jog;

      const hand_space = TILE_SIZE * 0.58;
      const ox = hand_space*Math.cos(angle) + d.x*jog*8;
      const oy = hand_space*Math.sin(angle) + d.y*jog*8;

      draw_tile(body, x + d.x*headjog*6,
                      y + d.y*headjog*6, TILE_SIZE);
      draw_tile(hand, x + ox + hanim_x,
                      y + oy + hanim_y, TILE_SIZE);
      draw_tile(hand, x - ox - hanim_x*0.7,
                      y - oy - hanim_y*0.7, TILE_SIZE);
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
