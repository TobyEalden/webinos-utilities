(function() {
  var ResponseHandler = function(notificationManager) {
    var logger = require("webinos-utilities").webinosLogging(__filename);
    var transactionManager = require("appg-transactionManager");

    var onNotify = function(notify) {
      var responseToTransaction;
      if (notify.data.hasOwnProperty("responseToTransaction")) {
        responseToTransaction = notify.data.responseToTransaction;
      } else {
        var responseToNotification = notificationManager.getNotification(notify.data.responseTo);
        if (typeof responseToNotification !== "undefined") {
          responseToTransaction = responseToNotification.data.id;
        }
      }
      if (typeof responseToTransaction !== "undefined") {
        // Create the transaction response.
        transactionManager.respondTransaction(responseToTransaction,notify.data.response);
      }
    };

    // Listen for transaction response notifications
    notificationManager.on(notificationManager.notifyType.appgTransactionResponse, onNotify);

    this.removeNotify = function() {
      notificationManager.removeListener(notificationManager.notifyType.appgTransactionResponse, onNotify);
    }
  };

  exports.Handler = ResponseHandler;
})();