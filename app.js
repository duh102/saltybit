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

request.post('http://www.saltybet.com/authenticate?signin=1')
  .form({email: config.email, pword: config.password, authenticate: "signin"});


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
    if(false && s.status == "open") {
      placeBet();
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
    res.write(JSON.stringify({salt: mySaltyBucks}));
    res.end();
  }).listen(config.apiPort);;
}
