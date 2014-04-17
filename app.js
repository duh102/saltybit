var io = require('socket.io-client');
var http = require('http');
var request = require('request');
var config = require("./config");
var http = require("http");
var sqlite3 = require('sqlite3');

var sock = io.connect("http://www-cdn-twitch.saltybet.com:8000");

var request = request.defaults({jar: true});

var mySaltyBucks = null;
var baseLine = null;
var db = new sqlite3.Database('./salty.db');
var players = {};

request.post('http://www.saltybet.com/authenticate?signin=1')
  .form({email: config.email, pword: config.password, authenticate: "signin"});

db.exec('CREATE TABLE IF NOT EXISTS fight(p1 INTEGER, p2 INTEGER, winner INTEGER, p1amount INTEGER, p2amount INTEGER, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(p1) REFERENCES player(id), FOREIGN KEY(p2) REFERENCES player(id));'
       +'CREATE TABLE IF NOT EXISTS player(id INTEGER primary key, name TEXT)', function(err) {
  if(err) return console.log(err);
});

db.each('SELECT id, name FROM player ORDER BY id', function(err, row) {
  players[row.name] = row.id;
});

sock.on("message", function(data) {
  updateState();
});

function log2(val) {
  return Math.log(val) / Math.log(2);
}

function setBaseAmount() {
  var possible = Math.pow(2, Math.floor(log2(mySaltyBucks)));
  if(possible > baseLine) baseLine = possible;
}

function getAmount() {
  /* It is only probablistically favourable to bet 1 at complete random
     Betting a larger amount without pre-knowledge ensures you lose to all
     the other people who do have pre-knowledge. More investigation will have to be done
   */
  return 1;
  /* The below is a 'safe' amount to bet if you're somewhat sure of the outcome. */
  if(mySaltyBucks <= baseLine) return 1;
  return Math.floor(Math.sqrt(mySaltyBucks - baseline));
}

function placeBet() {
  var toBet = "player" + (Math.round(Math.random())+1);
  var amount = getAmount();
  console.log("PLACING BET OF",amount,"ON", toBet);
  request.post("http://www.saltybet.com/ajax_place_bet.php")
  .form({radio: 'on', selectedplayer: toBet, wager: amount});
}

function updateState() {
  request("http://www.saltybet.com/state.json", function(e,r,body) {
    console.log(body);
    var s = JSON.parse(body);
    //betting things
    if(false && s.status == "open") {
      placeBet();
    }
    //logging outcomes
    else if(s.status === "1" || s.status === "2") {
      //keeping the in-memory hash up to date
      if(typeof players[s.p1name] === 'undefined') {
        db.prepare('INSERT INTO player (name) VALUES ($name)', {$name: s.p1name}, function(err) {
          if(err) console.log(err);
        }).get(function(err, row) {
          if(err) console.log(err);
        })
        db.prepare('SELECT id FROM player WHERE name = $name', {$name: s.p1name}, function(err) {
          if(err) console.log(err);
        }).get(function(err, row) {
          if(err) console.log(err);
          players[s.p1name] = row.id;
        });
        console.log(players)
      }
      if(typeof players[s.p2name] === 'undefined') {
        db.prepare('INSERT INTO player (name) VALUES ($name)', {$name: s.p2name}, function(err) {
          if(err) console.log(err);
        }).exec(function(err) {
          if(err) console.log(err);
        })
        db.prepare('SELECT id FROM player WHERE name = $name', {$name: s.p2name}, function(err) {
          if(err) console.log(err);
        }).get(function(err, row) {
          if(err) console.log(err);
          players[s.p2name] = row.id;
        });
      }
      var stmnt = db.prepare('INSERT INTO fight (p1, p2, winner, p1amount, p2amount) VALUES ($player1, $player2, $winner, $p1amount, $p2amount)',
        {$player1: players[s.p1name], $player2: players[s.p2name], $winner: s.status==="1"? 1:2, $p1amount: s.p1total, $p2amount: s.p2total},
        function(err) {
          if(err) console.log(err);
        }).get();
    }
  });

  request("http://www.saltybet.com/zdata.json", function(e,r,body) {
    var info = JSON.parse(body);
    for(var key in info) {
      if(info[key].n == config.name) {
        var cSaltyBucks = parseInt(info[key].b, 10);
        if(mySaltyBucks != cSaltyBucks) {
          mySaltyBucks = cSaltyBucks;
          setBaseAmount();
          console.log("Current salty bucks are: " + mySaltyBucks);
        }
      }
    }
  });
}

if(config.serveApi) {
  http.createServer(function(req,res) {
    var ranking ={};
    var matchrecord = {};
    var i =0;
    db.each('SELECT name, COUNT(*) as wins FROM player, fight WHERE (p1 = player.id AND winner = 1) OR (p2 = player.id AND winner = 2) GROUP BY player.id ORDER BY wins DESC',
      function(err, row) {
        if(err) console.log(err);
        ranking[i++] ={name: row.name, wins: row.id};
    });
    i=0;
    db.each('SELECT COUNT(*) as matches, p1.name as p1name, p2.name as p2name, winner FROM fight, player AS p1, player AS p2 WHERE p1 = p1.id AND p2 = p2.id GROUP BY p1, p2, winner',
      function(err, row) {
        if(err) console.log(err);
        matchrecord[i++] ={wins: row.matches,p1: row.p1name, p2: row.p2name, winner: row.winner};
    });
    res.write(JSON.stringify({salt: mySaltyBucks, players: players, ranking: ranking, matchrecord: matchrecord}));
    res.end();
  }).listen(config.apiPort);;
}
