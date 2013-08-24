(function() {
  var EmailHandler = function(notificationManager, config) {
    var onNotify = function(notify) {
      // Received notification.
      // Send e-mail
      var email = require("emailjs");
      var server  = email.server.connect(config.auth);

      var msg;
      if (notify.data.blocking) {
        msg = notify.data.origin + " is requesting a payment of " + notify.data.value + notify.data.currency + " via " + notify.data.source + " to " + notify.data.destination + " for " + notify.data.description;
        msg += "\r\n\r\nTo confirm payment: https://192.168.1.81/appg/response/confirm/" + notify.data.id;
        msg += "\r\n\r\nTo decline payment: https://192.168.1.81/appg/response/decline/" + notify.data.id;
      } else {
        msg = notify.data.origin + " payment issued for " + notify.data.value + notify.data.currency + " via " + notify.data.source + " to " + notify.data.destination + " for " + notify.data.description;
      }

      // Send the message and get a callback with an error or details of the message that was sent.
      server.send({
        text:    msg,
        from:    config.auth.user,
        to:      config.email,
        cc:      "",
        subject: "Aegis PPG transaction " + (notify.data.blocking ? "request" : "notification")
      }, function(err, message) { console.log(err || message); });
    };

    // Add listener to receive notification of permission requests.
    notificationManager.on(notificationManager.notifyType.appgTransaction, onNotify);

    this.removeNotify = function() {
      notificationManager.removeListener(notificationManager.notifyType.appgTransaction, onNotify);
    }
  }

  exports.Handler = EmailHandler;
})()