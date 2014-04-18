var io = require('socket.io-client');
var http = require('http');
var request = require('request');
var config = require("./config");
var sqlite3 = require('sqlite3');

var sock = io.connect("http://www-cdn-twitch.saltybet.com:8000");

var request = request.defaults({jar: true});

var mySaltyBucks = null;
var baseLine = null;
var db = new sqlite3.Database('./salty.db');
var recommendation = null;
var recommendationOdds = null;


request.post('http://www.saltybet.com/authenticate?signin=1')
  .form({email: config.email, pword: config.password, authenticate: "signin"});

db.exec('CREATE TABLE IF NOT EXISTS fight(p1 INTEGER, p2 INTEGER, winner INTEGER, p1amount INTEGER, p2amount INTEGER, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(p1) REFERENCES player(id), FOREIGN KEY(p2) REFERENCES player(id));'
       +'CREATE TABLE IF NOT EXISTS player(id INTEGER primary key, name TEXT)', function(err) {
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
      player2totalwins = 0;

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
      db.all('SELECT name, COUNT(*) as wins FROM player, fight WHERE ((p1 = player.id AND winner = 1) OR (p2 = player.id AND winner = 2)) AND (player.name = ? OR player.name = ?) GROUP BY player.id',
        [player1, player2], function(err, rows) {
        for(i = 0; i < rows.length; i++) {
          if(rows[i].name == player1) {
            player1totalwins = rows[i].wins;
          }
          else {
            player2totalwins = rows[i].wins;
          }
        }

        winDifference = player1wins - player2wins;
        if((player1wins > 3 || player2wins > 3) && Math.abs(winDifference) > 2) {
            recommendation = player1wins > player2wins? 1 : 2;
            recommendationOdds = player1wins > player2wins? player1wins+":"+player2wins : player2wins+":"+player1wins;
        }
        else {
          recommendation = 0;
          recommendationOdds = player1wins+":"+player2wins;
        }
        switch(recommendation)
        {
          case 0:
            console.log('recommendation for this fight: neither. odds: '+recommendationOdds+' soft odds: '+player1totalwins+':'+player2totalwins);
            break;
          case 1:
            console.log('recommendation for this fight: '+player1+'. odds: '+recommendationOdds+' soft odds: '+player1totalwins+':'+player2totalwins);
            break;
          case 2:
            console.log('recommendation for this fight: '+player2+'. odds: '+recommendationOdds+' soft odds: '+player2totalwins+':'+player1totalwins);
            break;
        }
      });
    });
}

function updateState() {
  request("http://www.saltybet.com/state.json", function(e,r,body) {
    console.log(body);
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
      //keeping the in-memory hash up to date
      db.serialize(function() {
        db.run('INSERT OR IGNORE INTO player (name) VALUES (?)', [s.p1name], function(err) {
          if(err) console.log(err);
        }).run('INSERT OR IGNORE INTO player (name) VALUES (?)', [s.p2name], function(err) {
          if(err) console.log(err);
        });
        var stmnt = db.prepare('INSERT INTO fight (p1, p2, winner, p1amount, p2amount) VALUES ((SELECT id FROM player WHERE name = ?), (SELECT id FROM player WHERE name = ?), ?, ?, ?)',
          [s.p1name, s.p2name, s.status==="1"? 1:2, s.p1total.replace(/,/g,''), s.p2total.replace(/,/g,'')],
          function(err) {
            if(err) console.log(err);
        }).get();
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

  

if(config.serveApi) {
  http.createServer(function(req,res) {
    var params = req.url.split(/\//);
    params.shift();
    var ranking = [];
    var matchrecord = [];
    var players = [];
    var bigwinners = [];
    var start = 0;
    if(typeof params[1] !== 'undefined') {
      start = Math.max((parseInt((params[1]-params[1]%1))-1) * 40, 0);
    }
 
    var playerListing = function() {
      db.each('SELECT id, name FROM player ORDER BY id LIMIT ?, 40', [start], function(err, row) {
        if(err) console.log(err);
        players[row.id] = row.name;
      }, function(err, numRows) {
        if(err) console.log(err);
        output();
      });
    },
    leaderboard = function() {
      db.each('SELECT name, COUNT(*) as wins FROM player, fight WHERE (p1 = player.id AND winner = 1) OR (p2 = player.id AND winner = 2) GROUP BY player.id ORDER BY wins DESC LIMIT ?, 40',
      [start], function(err, row) {
        if(err) console.log(err);
        ranking.push({name: row.name, wins: row.wins});
      }, function(err, numRows) {
        if(err) console.log(err);
        output();
      });
    },
    matchupTable = function() {
      db.each('SELECT COUNT(*) as matches, p1.name as p1name, p2.name as p2name, winner FROM fight, player AS p1, player AS p2 WHERE p1 = p1.id AND p2 = p2.id GROUP BY p1, p2, winner LIMIT ?, 40',
      [start], function(err, row) {
        if(err) console.log(err);
        matchrecord.push({wins: row.matches,p1: row.p1name, p2: row.p2name, winner: row.winner});
      }, function(err, numRows) {
        if(err) console.log(err);
        output();
      });
    },
    winningsRanking = function() {
      db.each('SELECT name, SUM(profit) as totalprofit FROM '
            +'(SELECT name, SUM(p1amount) as profit FROM player, fight WHERE p1 = player.id GROUP BY p1 '
            +'UNION '
            +'SELECT name, SUM(p2amount) as profit FROM player, fight WHERE p2 = player.id GROUP BY p2) '
            +'GROUP BY name '
            +'ORDER BY totalprofit DESC '
            +'LIMIT ?, 40',
      [start], function(err, row) {
        if(err) console.log(err);
        bigwinners.push({name: row.name, profit: row.totalprofit});
      }, function(err, numRows) {
        if(err) console.log(err);
        output();
      });
    },
    output = function() {
      if(ranking.length > 0) {
        res.write(JSON.stringify({salt: mySaltyBucks, leaderboard: ranking}));
      }
      else if(matchrecord.length > 0) {
        res.write(JSON.stringify({salt: mySaltyBucks, matchuptable: matchrecord}));
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
        playerListing();
        break;
      case 'leaderboard':
        leaderboard();
        break;
      case 'matchuptable':
        matchupTable();
        break;
      case 'winningsranking':
        winningsRanking();
        break;
      default:
        output();
        break;
    }

  }).listen(config.apiPort);
}