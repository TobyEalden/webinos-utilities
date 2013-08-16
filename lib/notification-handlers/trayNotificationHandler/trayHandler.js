(function() {
  var TrayHandler = function(notificationManager) {
    var webinosPath = require("webinos-utilities").webinosPath.webinosPath();
    var fs = require('fs');
    var path = require('path');

    // Listen for **all** notifications
    notificationManager.on(notificationManager.notifyType.all, function(notify) {
      var msg;

      switch (notify.type) {
        case notificationManager.notifyType.permissionRequest:
          msg = "User " +  notify.data.request.subjectInfo.userId + " has requested access to " + notify.data.request.resourceInfo.apiFeature;
          break;
        case notificationManager.notifyType.permissionResponse:
          var responseTo = notificationManager.getNotification(notify.data.responseTo);
          if (typeof responseTo !== "undefined") {
            var response;
            if (parseInt(notify.data.response) > 2) {
              response = "permitted";
            } else  {
              response = "denied"
            }
            msg = "User " +  responseTo.data.request.subjectInfo.userId + " was " + response + " access to " + responseTo.data.request.resourceInfo.apiFeature;
          }
          break;
        case notificationManager.notifyType.connectionRequest:
          msg = notify.data.user.email + " has requested to connect with your zone";
          break;
        case notificationManager.notifyType.appgTransaction:
          if (notify.data.blocking) {
            msg = notify.data.origin + " is requesting a payment of " + notify.data.value + notify.data.currency + " via " + notify.data.source + " to " + notify.data.destination + " for " + notify.data.description;
          } else {
            msg = notify.data.origin + " payment issued for " + notify.data.value + notify.data.currency + " via " + notify.data.source + " to " + notify.data.destination + " for " + notify.data.description;
          }
          break;
        case notificationManager.notifyType.appgTransactionResponse:
          var trans;
          if (notify.data.hasOwnProperty("responseTo")) {
          var responseTo = notificationManager.getNotification(notify.data.responseTo);
          if (typeof responseTo !== "undefined") {
              trans = responseTo.data;
            }
          }

          if (typeof trans !== "undefined") {
            if (notify.data.response === "confirmed") {
              msg = "Payment confirmed - " + trans.origin + " payment of " + trans.value + trans.currency + " via " + trans.source + " to " + trans.destination + " for " + trans.description;
            } else {
              msg = "Payment DECLINED - " + trans.origin + " payment of " + trans.value + trans.currency + " via " + trans.source + " to " + trans.destination + " for " + trans.description;
            }
          }
          break;
        default:
          break;
      }

      if (typeof msg !== "undefined") {
        var uuid = require("node-uuid");
        var file = path.join(webinosPath,"wrt",uuid.v1() + ".notify");
        fs.writeFileSync(file,msg);
      }
    });
  }

  exports.Handler = TrayHandler;
})()