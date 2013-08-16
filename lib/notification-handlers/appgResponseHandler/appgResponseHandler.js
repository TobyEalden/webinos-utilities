(function() {
  var ResponseHandler = function(notificationManager) {
    var logger = require("webinos-utilities").webinosLogging(__filename);
    var transactionManager = require("appg-transactionManager");

    // Listen for transaction response notifications
    notificationManager.on(notificationManager.notifyType.appgTransactionResponse, function(notify) {
      var responseTo = notificationManager.getNotification(notify.data.responseTo);
      if (typeof responseTo !== "undefined") {
        var responseToTransaction = responseTo.data.id;
        var decision = notify.data.response;
        // Create the transaction response.
        transactionManager.respondTransaction(responseToTransaction,decision);
      }
    });
  };

  exports.Handler = ResponseHandler;
})();