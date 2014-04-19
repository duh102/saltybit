$(function() {
  var socket = io.connect('127.0.0.1:3005');
   $('.messageLog').text('Waiting message from server');
  socket.on('message', function (message, callback) {
    $('.messageLog').text(new Date()+": "+message);
  });
  socket.on('disconnect', function() {
    $('.messageLog').text('Server disconnected :(');
  });
});