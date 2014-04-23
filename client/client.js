$(function() {
  var socket = io.connect("127.0.0.1:3005");
   $('.messageLog').text('Waiting message from server');
  socket.on('message', function (message, callback) {
    var msgObj = JSON.parse(message);
    switch(msgObj.msgtype) {
      case 'recommend':
        //{msgtype: 'recommend', p1: {name: player1, wins: player1totalwins, losses: player1totallosses, matchwins: player1wins},
        //p2: {name: player2, wins: player2totalwins, losses: player2totallosses, matchwins: player2wins}, recommendation: recommendation}
        var txt = msgObj.p1.name+' ('+msgObj.p1.wins+'/'+msgObj.p1.losses+') vs '+msgObj.p2.name+' ('+msgObj.p2.wins+'/'+msgObj.p2.losses+'), recommendation: ';
        switch(msgObj.recommendation) {
          case 0:
          txt+='neither, matchup score: ('+msgObj.p1.matchwins+'/'+msgObj.p2.matchwins+')';
          break;
          case 1:
          txt+=msgObj.p1.name+', matchup score: ('+msgObj.p1.matchwins+'/'+msgObj.p2.matchwins+')';
          break;
          case 2:
          txt+=msgObj.p2.name+', matchup score: ('+msgObj.p2.matchwins+'/'+msgObj.p1.matchwins+')';
          break;
        }
        $('.messageLog').text(dateFormat(new Date(), "dd/mm/yy h:MM:ss TT")+": "+txt);
        break;
      case 'leaderboard':
        //({msgtype: 'leaderboard', data: [{name: row.name, wins: row.wins, losses: row.losses},...]}
        var table = 'Last updated: '+dateFormat(new Date(), "dd/mm/yy h:MM:ss TT")
                  +'\n<table>\n\t<tr><th>Player</th><th>Wins</th><th>Losses</th></tr>\n';
        msgObj.data.forEach(function(row) {
          table+='\t<tr><td>'+row.name+'</td><td>'+row.wins.toLocaleString()+'</td><td>'+row.losses.toLocaleString()+'</td></tr>\n';
        });
        table+='\n</table>';
        $('.leaderboard').html(table);
        break;
      case 'winningsranking':
        //{msgtype: 'winningsranking', data: [{name: row.name, profit: row.totalprofit},...]}
        var table = 'Last updated: '+dateFormat(new Date(), "dd/mm/yy h:MM:ss TT")
                  +'\n<table>\n\t<tr><th>Player</th><th>Profit</th></tr>\n';
        msgObj.data.forEach(function(row) {
          table+='\t<tr><td>'+row.name+'</td><td>$'+row.profit.toLocaleString()+'</td></tr>\n';
        });
        table+='\n</table>';
        $('.winningsranking').html(table);
        break;
      case 'init':
        //{msgtype: 'init', msg: 'message...'}
        var txt = msgObj.msg;
        $('.messageLog').text(dateFormat(new Date(), "dd/mm/yy h:MM:ss TT")+": "+txt);
        break;
    }
  });
  socket.on('disconnect', function() {
    $('.messageLog').text(dateFormat(new Date(), "dd/mm/yy h:MM:ss TT")+' Server disconnected :(');
  });
});