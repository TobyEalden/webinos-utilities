(function() {
  var PromptHandler = function(notificationManager) {
    var logger = require("webinos-utilities").webinosLogging(__filename);
    var promptTimeout = 20000;
    var path = require("path");
    var dashboard;

    try {
      dashboard = require("webinos-dashboard");
    } catch (e) {
      // ignore.
    }

    if (typeof dashboard !== "undefined") {

      // Register the prompting dashboard module
      dashboard.registerModule("appgTransaction","Aegis PPG transaction",path.join(__dirname,"./dashboard/"));

      // Listen for permission request notifications
      notificationManager.on(notificationManager.notifyType.appgTransaction, function(notify) {
        // Received APPG transaction notification => check if it requires user response...
        if (notify.data.blocking === true) {
          // For blocking transactions, use the dashboard to prompt the user.
        dashboard.open(
          {
            module:"appgTransaction",
            data:{
              notifyId: notify.id,
              transaction: notify.data,
              timeout: promptTimeout
            }
          },
          function() {
            logger.log("transaction prompt success callback");
          },
          function(err) {
            logger.log("transaction prompt error callback: " + err.toString());
          },
          function (response){
            logger.log("transaction prompt complete callback: " + JSON.stringify(response));

            var responseTo = response.responseTo;
            var decision = parseInt(response.decision);
            notificationManager.addNotification(notificationManager.notifyType.appgTransactionResponse, { responseTo: responseTo, response: decision });
          }
        );
        }
      });

    } else {
      logger.log("webinos-dashboard not found - can't start transaction prompt handler.");
    }
  };

  exports.Handler = PromptHandler;
})()