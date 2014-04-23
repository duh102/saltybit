var io = require('socket.io-client');
var http = require('http');
var request = require('request');
var config = require("./config");
var sqlite3 = require('sqlite3');
if(config.serveSocket) {
  var ioServ = require('socket.io').listen(config.socketPort).set('log level', 0);
}

var sock = io.connect("http://www-cdn-twitch.saltybet.com:8000");

var request = request.defaults({jar: true});

var mySaltyBucks = null;
var baseLine = null;
var db = new sqlite3.Database('./salty.db');
var recommendation = null;
var clients = [];
var leaderboardUTD = false,
winningsUTD = false;
var firstPageLeaderboard = [],
firstPageWinningsRanking = [];


request.post('http://www.saltybet.com/authenticate?signin=1')
  .form({email: config.email, pword: config.password, authenticate: "signin"});

db.exec('CREATE TABLE IF NOT EXISTS fight(p1 INTEGER, p2 INTEGER, winner INTEGER, p1amount INTEGER, p2amount INTEGER, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(p1) REFERENCES player(id), FOREIGN KEY(p2) REFERENCES player(id));'
       +'CREATE TABLE IF NOT EXISTS player(id INTEGER primary key, name TEXT UNIQUE ON CONFLICT IGNORE)', function(err) {
  if(err) return console.log(err);
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
  return 50;
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

function getRecommendation(player1, player2) {
  db.all('SELECT COUNT(*) as matches, p1.name as p1name, p2.name as p2name, winner FROM fight, player AS p1, player AS p2 WHERE p1 = p1.id AND p2 = p2.id AND ((p1.name = ?1 AND p2.name = ?2) OR (p1.name = ?2 AND p2.name = ?1)) GROUP BY p1, p2, winner',
    [player1, player2], function(err, rows) {
      var player1wins = 0,
      player2wins = 0,
      winDifference = 0,
      player1totalwins = 0,
      player2totalwins = 0,
      player1totallosses = 0,
      player2totallosses = 0;

      for(i = 0; i < rows.length; i++) {
        if(rows[i].p1name == player1) {
          if(rows[i].winner == 1) {
            player1wins++;
          }
          else {
            player2wins++;
          }
        } else {
          if(rows[i].winner == 2) {
            player1wins++;
          }
          else {
            player2wins++;
          }
        }
      }
      db.all('SELECT pwin.id AS id, pwin.name AS name, pwin.wins AS wins, plose.losses AS losses FROM '
            +'(SELECT p1.id, p1.name, coalesce(wins, 0) AS wins FROM '
            +'((SELECT id, name from player WHERE (name = ?1 OR name = ?2)) p1 '
            +'LEFT OUTER JOIN '
            +'(SELECT id, COUNT(*) AS wins FROM player, fight WHERE '
            +'(p1 = player.id AND winner = 1) OR (p2 = player.id AND winner = 2) '
            +' GROUP BY player.id) p2 '
            +'ON p1.id = p2.id)) pwin '
            +'INNER JOIN '
            +'(SELECT p1.id, p1.name, coalesce(losses, 0) AS losses FROM '
            +'((SELECT id, name from player WHERE (name = ?1 OR name = ?2)) p1 '
            +'LEFT OUTER JOIN '
            +'(SELECT id, COUNT(*) AS losses FROM player, fight WHERE '
            +'(p1 = player.id AND winner = 2) OR (p2 = player.id AND winner = 1) '
            +' GROUP BY player.id) p2 '
            +'ON p1.id = p2.id)) plose '
            +'ON pwin.id = plose.id '
            +'ORDER BY ((pwin.wins+3)/(plose.losses+3)) DESC, pwin.wins DESC',
        [player1, player2], function(err, rows) {
        for(i = 0; i < rows.length; i++) {
          if(rows[i].name == player1) {
            player1totalwins = rows[i].wins;
            player1totallosses = rows[i].losses;
          }
          else {
            player2totalwins = rows[i].wins;
            player2totallosses = rows[i].losses;
          }
        }

        winDifference = player1wins - player2wins;
        if((player1wins > 3 || player2wins > 3) && Math.abs(winDifference) > 2) {
            recommendation = player1wins > player2wins? 1 : 2;
        }
        else {
          recommendation = 0;
        }
        ioServ.sockets.emit('message', JSON.stringify({msgtype: 'recommend', p1: {name: player1, wins: player1totalwins, losses: player1totallosses, matchwins: player1wins},
          p2: {name: player2, wins: player2totalwins, losses: player2totallosses, matchwins: player2wins}, recommendation: recommendation}));
      });
    });
}

function updateState() {
  request("http://www.saltybet.com/state.json", function(e,r,body) {
    var s = JSON.parse(body);
    //betting things
    if(s.status == "open") {
      getRecommendation(s.p1name, s.p2name);
      if(false) {
        placeBet();
      }
    }
    //logging outcomes
    else if(s.status === "1" || s.status === "2") {
      db.run('INSERT OR IGNORE INTO player (name) VALUES (?)', [s.p1name], function(err) {
        if(err) console.log(err);
        db.run('INSERT OR IGNORE INTO player (name) VALUES (?)', [s.p2name], function(err) {
          if(err) console.log(err);
          var stmnt = db.prepare('INSERT INTO fight (p1, p2, winner, p1amount, p2amount) VALUES ((SELECT id FROM player WHERE name = ? ORDER BY id ASC), (SELECT id FROM player WHERE name = ? ORDER BY id ASC), ?, ?, ?)',
            [s.p1name, s.p2name, s.status==="1"? 1:2, s.p1total.replace(/,/g,''), s.p2total.replace(/,/g,'')],
            function(err) {
              if(err) console.log(err);
          }).get({}, function(err, row) {
            leaderboardUTD = false;
            winningsUTD = false;

            getLeaderboard(0, function(leader) {
              firstPageLeaderboard = leader;
              leaderboardUTD = true;
              updateClientTables();
            });
            getWinningsRanking(0, function(ranking) {
              firstPageWinningsRanking = ranking;
              winningsUTD = true;
              updateClientTables();
            });
          });
        });
      });
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

function updateClientTables() {
  if(leaderboardUTD && winningsUTD) {
    ioServ.sockets.emit('message', JSON.stringify({msgtype: 'leaderboard', data: firstPageLeaderboard}));
    ioServ.sockets.emit('message', JSON.stringify({msgtype: 'winningsranking', data: firstPageWinningsRanking}));
  }
}

function updateClientTable(socket) {
  if(leaderboardUTD && winningsUTD) {
    socket.emit('message', JSON.stringify({msgtype: 'leaderboard', data: firstPageLeaderboard}));
    socket.emit('message', JSON.stringify({msgtype: 'winningsranking', data: firstPageWinningsRanking}));
  }
}

function getPlayerListing(start, callback) {
  var players = [];
  db.each('SELECT id, name FROM player ORDER BY id LIMIT ?, 40', [start], function(err, row) {
    if(err) console.log(err);
    players[row.id] = row.name;
  }, function(err, numRows) {
    if(err) console.log(err);
    callback(players);
  });
}

function getLeaderboard(start, callback) {
  var ranking = [];
  db.each('SELECT pwin.id AS id, pwin.name AS name, pwin.wins AS wins, plose.losses AS losses FROM '
        +'(SELECT p1.id, p1.name, coalesce(wins, 0) AS wins FROM '
        +'((SELECT id, name from player) p1 '
        +'LEFT OUTER JOIN '
        +'(SELECT id, COUNT(*) AS wins FROM player, fight WHERE '
        +'(p1 = player.id AND winner = 1) OR (p2 = player.id AND winner = 2) '
        +' GROUP BY player.id) p2 '
        +'ON p1.id = p2.id)) pwin '
        +'INNER JOIN '
        +'(SELECT p1.id, p1.name, coalesce(losses, 0) AS losses FROM '
        +'((SELECT id, name from player) p1 '
        +'LEFT OUTER JOIN '
        +'(SELECT id, COUNT(*) AS losses FROM player, fight WHERE '
        +'(p1 = player.id AND winner = 2) OR (p2 = player.id AND winner = 1) '
        +' GROUP BY player.id) p2 '
        +'ON p1.id = p2.id)) plose '
        +'ON pwin.id = plose.id '
        +'ORDER BY ((pwin.wins+3)/(plose.losses+3)) DESC, pwin.wins DESC LIMIT ?, 40',
  [start], function(err, row) {
    if(err) console.log(err);
    ranking.push({name: row.name, wins: row.wins, losses: row.losses});
  }, function(err, numRows) {
    if(err) console.log(err);
    callback(ranking);
  });
}

function getWinningsRanking(start, callback) {
  var bigwinners = [];
  db.each('SELECT name, SUM(profit) as totalprofit FROM '
        +'(SELECT name, SUM(p2amount) as profit FROM player, fight WHERE p1 = player.id AND winner = 1 GROUP BY p1 '
        +'UNION '
        +'SELECT name, SUM(p1amount) as profit FROM player, fight WHERE p2 = player.id AND winner = 2 GROUP BY p2) '
        +'GROUP BY name '
        +'ORDER BY totalprofit DESC '
        +'LIMIT ?, 40',
  [start], function(err, row) {
    if(err) console.log(err);
    bigwinners.push({name: row.name, profit: row.totalprofit});
  }, function(err, numRows) {
    if(err) console.log(err);
    callback(bigwinners);
  });
}

if(config.serveApi) {
  http.createServer(function(req,res) {
    var bigwinners = [];
    var ranking = [];
    var players = [];
    var params = req.url.split(/\//);
    params.shift();
    var start = 0;
    if(typeof params[1] !== 'undefined') {
      start = Math.max((parseInt((params[1]-params[1]%1))-1) * 40, 0);
    }
 
    var output = function() {
      if(ranking.length > 0) {
        res.write(JSON.stringify({salt: mySaltyBucks, leaderboard: ranking}));
      }
      else if(players.length > 0) {
        res.write(JSON.stringify({salt: mySaltyBucks, playerlisting: players}));
      }
      else if(bigwinners.length > 0) {
        res.write(JSON.stringify({salt: mySaltyBucks, winningsranking: bigwinners}));
      }
      else {
        res.write(JSON.stringify({salt: mySaltyBucks}));
      }
      res.end();
    };

    switch(params[0])
    {
      case 'playerlisting':
        if(start > 0) {
          getPlayerListing(start, function(tempPlayer) {
            players = tempPlayer;
            output();
          });
        }
        else {
          players = firstPagePlayerList;
          output();
        }
        break;
      case 'leaderboard':
        if(start > 0) {
          getLeaderboard(start, function(tempBoard) {
            ranking = tempBoard;
            output();
          });
        }
        else {
          ranking = firstPageLeaderboard;
          output();
        }
        break;
      case 'winningsranking':
        if(start > 0) {
          getWinningsRanking(start, function(tempWinnings) {
            bigwinners = tempWinnings;
            output();
          });
        }
        else {
          bigwinners = firstPageWinningsRanking;
          output();
        }
        break;
      default:
        output();
        break;
    }

  }).listen(config.apiPort);
}

if(config.serveSocket) {
  ioServ.sockets.on('connection', function (socket) {
    socket.clientIndex = clients.push(socket)-1;
    console.log('client '+socket.clientIndex+' connected');
    socket.emit('message', JSON.stringify({msgtype: 'init', msg: 'No recommendation yet, wait for next match'}));
    updateClientTable(socket);

    socket.on('disconnect', function () {
      console.log('client '+socket.clientIndex+' disconnected');
      if(socket.clientIndex >= 0) clients.splice(socket.clientIndex, 1);
    });

    socket.on('message', function(message) {
      console.log(message);
    });
  });
}