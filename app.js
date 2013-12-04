var io = require('socket.io-client');
var http = require('http');
var request = require('request');
var config = require("./config");

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
  if(mySaltyBucks < baseLine) return 1;
  return Math.floor(Math.sqrt(mySaltyBucks - baseline));
}

function placeBet() {
  if(mySaltyBucks === null) return;
  var toBet = "player" + (Math.round(Math.random())+1);
  var amount = getAmount();
  console.log("PLACING BET OF",amount,"ON", toBet);
  request.post("http://www.saltybet.com/ajax_place_bet.php")
  .form({radio: 'on', selectedplayer: toBet, wager: amount});
}

function updateState() {
  request("http://www.saltybet.com/state.json", function(e,r,body) {
    var s = JSON.parse(body);
    if(s.status == "open") {
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
