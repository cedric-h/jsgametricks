// vim: sw=2 ts=2 expandtab smartindent ft=javascript
//
/* maybe we will want to make the game tick less often on the server
 * to save CPU cycles, or maybe we need to tick the game faster
 * to resolve a timing bug.
 *
 * by configuring times like 2*SECOND_IN_TICKS, not only does the
 * developer get to think in terms of a unit they're already
 * familiar with -- seconds -- they also get the ability to
 * change how many times per second their game logic runs,
 * simply by changing this variable. */
const SECOND_IN_TICKS = 60; 

/* -- NETSIM: USING CODE TO PRETEND YOU HAVE FRIENDS -- */
/* Being able to step through your application in a debugger is nice:
 * Why not make it so you can step through your _entire_ application,
 * server and client, seamlessly?
 *
 * (also, I'll admit, I just like having everything in the same file)
 *
 * host:
 *  - each of the clients can send messages to it
 *  - it updates at, say, 60hz, and broadcasts updates out to clients.
 *
 * client:
 *  - can send and receive messages from the host
 *  - can't talk directly to other clients
 *  - takes updates from host and draws them on the screen
 *  - also sends input events to the server
 * 
 * We can "send messages" all from within the same browser window,
 * no problem!
 *
 * for example, here's a simple echo host:
 */

{
  function echoing_host(server) {
    let players = [];

    server.onconnect = client => {
      players.push(client);

      client.onmessage = msg => {
        for (const p of players)
          if (p != client)
            p.get_from_host(msg);
      };
    }
  }

  /* all we need to do to "simulate" this is ... */

  const make_client = () => ({
    /* this is how i send things to the host */
    send_to_host(msg) {
      if (this.onmessage)
        this.onmessage(msg);
    }
  });

  const server = {};
  echoing_host(server);


  const bob = make_client();
  const alice = make_client();
  bob.get_from_host = msg => console.log("[bob] got " + msg);
  alice.get_from_host = msg => console.log("[alice] got " + msg);

  /* connect them to the server */
  server.onconnect(bob);
  server.onconnect(alice);

  /* use the server to have them talk to each other */
  bob.send_to_host("hi");
  alice.send_to_host("!!!");
}

/* basically, if our server is just a "host" function,
 * we can pass actual networking messages into it from node,
 *
 * or we can pass it messages that originated from the exact
 * same browser window.
 *
 * the difference is negligible! */
function host(server) {
  const state = {
    tick: 0,
    particles: [],
    sprinklers: [
      { x: 0.5, y: 0.5 },
    ],
  };
  const clients = [];

  server.onconnect = client => {
    clients.push(client);

    client.onmessage = msg => {
      const [type, payload] = JSON.parse(msg);

      if (type == "sprinkler_place") {
        const { x, y } = payload;
        state.sprinklers.push({ x, y })
      }
    }
  };

  (function update() {
    setTimeout(update, 1000/20);

    {
      /* discard the fields we don't want to send them */
      const { tick, sprinklers } = state;
      const particles = state.particles.map(({ x, y }) => ({ x, y }));

      for (const c of clients)
        c.send(["tick", { tick, sprinklers, particles }]);
    }

    state.tick++;

    for (const sprink of state.sprinklers) {
      /* ten times a second, sprinklers spawn particles */
      if ((state.tick % SECOND_IN_TICKS/10) == 0) {
        state.particles.push({
          x: sprink.x,
          y: sprink.y,
          death_tick: state.tick + SECOND_IN_TICKS*10,

          /* turn the current tick into an angle,
           * and from an angle into a velocity vector. */
          vx: Math.cos(state.tick + sprink.x*10),
          vy: Math.sin(state.tick + sprink.y*10),
        });
      }
    }

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
  })();
}

if ((typeof window) != "object") host({});
if ((typeof window) == "object") window.onload = function frame() {
  requestAnimationFrame(frame);

  const canvas = document.getElementById("player1");
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  render(canvas, {
    tick: 0,
    sprinklers: [
      { x: 0.5, y: 0.5 },
    ],
    particles: []
  });
}


function render(canvas, state) {
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
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 1, 1);

    for (const { x, y } of state.sprinklers) {
      const size = 0.05;
      ctx.fillStyle = "blue";
      ctx.fillRect(x - size/2, y - size/2, size, size);
    }
    for (const { x, y, death_tick } of state.particles) {
      const size = 0.01;

      /* canvas treats alphas > 1 the same as 1 */
      const ttl = death_tick - state.tick;
      ctx.globalAlpha = ttl / SECOND_IN_TICKS;

      ctx.fillStyle = "purple";
      ctx.fillRect(x - size/2, y - size/2, size, size);

      /* bad things happen if you forget to reset this */
      ctx.globalAlpha = 1.0;
    }

  }; ctx.restore();
}
