(function(exports) {
  var fs = require('fs');
  var path = require('path');
  var webinosPath = require("./webinosPath.js").webinosPath();
  var eventEmitter = require('events').EventEmitter;
  var util = require('util');
  var uuid = require('node-uuid');
  var filePath;
  var locked = false;
  var existsSync = fs.existsSync || path.existsSync;

  var NotificationManager = function(pzhObject) {
    var _self = this;

    if (typeof pzhObject !== "undefined") {
      _self.pzh = pzhObject;
    }

    eventEmitter.call(this);
    this.notifyType = {
      all: "all",
      notification: "notification",
      permissionRequest: "permissionRequest",
      permissionResponse: "permissionResponse",
      connectionRequest: "connectionRequest",
      appgTransaction: "appgTransaction",
      appgTransactionResponse: "appgTransactionResponse",
      sync: "sync"
    };

    process.nextTick(function() { _self.initialiseNotifications(); });
  };

  util.inherits(NotificationManager, eventEmitter);

  NotificationManager.prototype.getListFilename = function() {
    var f;
    if (typeof this.pzh === "undefined") {
      f = path.join(webinosPath,"userData/notifications.json");
    } else {
      f = path.join(this.pzh.getWebinosRoot(),"userData/notifications.json");
    }
    return f;
  }

  function getEmptyConfig() {
    return {
      promptNotification: {},
      emailNotification: {},
      trayNotification: {},
      appgPromptNotification: {},
      appgEmailNotification: {},
      appgSMSNotification: {},
      appgVoiceNotification: {}
    };
  }

  NotificationManager.prototype.loadList = function() {
    var listFile = this.getListFilename();
    var list;
    if (existsSync(listFile)) {
      var fileContents = fs.readFileSync(listFile);
      list = JSON.parse(fileContents);
    } else {
      list = {
        notifications: {},
        config: getEmptyConfig()
      };
    }
    return list;
  }

  NotificationManager.prototype.saveList = function(list) {
    var listFile = this.getListFilename();
    var fileContents = JSON.stringify(list,null,2);
    fs.writeFileSync(listFile,fileContents);
  }

  NotificationManager.prototype.initialiseNotifications = function(){
    var _self = this;

    // Register the notifications dashboard module
    try {
      var dashboard = require("webinos-dashboard");
      dashboard.registerModule("notifications","Notifications", path.join(__dirname,"./dashboard/"));
    } catch (e) {
      // ignore.
    }

    // Create notification handlers.
    var notificationConfig = _self.getConfig();
    var utilities = require("webinos-utilities");
    utilities.webinosId.fetchWebinosName("Pzp",null, function(entName) {
      if (typeof _self.pzh === "undefined") {
        // Only issue prompt and tray notifications on PZPs
        if (!notificationConfig.promptNotification || !notificationConfig.promptNotification.hasOwnProperty(entName) || notificationConfig.promptNotification[entName] === true) {
          var promptHandler = new utilities.webinosNotifications.PromptHandler(_self,notificationConfig.promptNotification);
          console.log(">>>>>> starting policy prompt handler");
        }
        if (!notificationConfig.appgPromptNotification || !notificationConfig.appgPromptNotification.hasOwnProperty(entName) || notificationConfig.appgPromptNotification[entName] === true) {
          var appgPromptHandler = new utilities.webinosNotifications.APPGPromptHandler(_self,notificationConfig.appgPromptNotification);
          console.log(">>>>>> starting appg transaction prompt handler");
        }
        if (notificationConfig.trayNotification && notificationConfig.trayNotification.hasOwnProperty(entName) && notificationConfig.trayNotification[entName] === true) {
          var trayHandler = new utilities.webinosNotifications.TrayHandler(_self,notificationConfig.trayNotification);
          console.log(">>>>>> starting tray notification handler");
        }
      } else {
        // Only issue e-mail, SMS and voice notifications from PZH.
        if (notificationConfig.emailNotification && notificationConfig.emailNotification.hasOwnProperty(entName) && notificationConfig.emailNotification[entName] === true) {
          var emailHandler = new utilities.webinosNotifications.EmailHandler(_self,notificationConfig.emailNotification);
          console.log(">>>>>> starting email notification handler");
        }
        var transactionResponseHandler = new utilities.webinosNotifications.APPGResponseHandler(_self);
        console.log(">>>>>> starting appg transaction response handler");
      }
    });
  }

  NotificationManager.prototype.getConfig = function() {
    var list = this.loadList();
    if (typeof list.config === "undefined") {
      list.config = getEmptyConfig();
    }
    return list.config;
  };

  NotificationManager.prototype.setConfig = function(cfg) {
    var list = this.loadList();
    list.config = cfg;
    this.saveList(list);
  };

  // Retrieve a specific notification from the list
  NotificationManager.prototype.getNotification = function(id) {
    var list = this.loadList();

    var notify;
    if (list.notifications.hasOwnProperty(id)) {
      notify = list.notifications[id];
    }

    return notify;
  };

  // Retrieve all notifications (optionally of a given type)
  NotificationManager.prototype.getNotifications = function(type) {
    var list = this.loadList();

    var lst = { notifications: {}};

    for (var id in list.notifications) {
      if (list.notifications.hasOwnProperty(id) && (typeof type === "undefined" || type === "" || list.notifications[id].type === type)) {
        lst.notifications[id] = list.notifications[id];
      }
    }

    lst.config = list.config;

    return lst;
  };

  NotificationManager.prototype.addNotification = function(type,data) {
    locked = true;

    var notify = {};

    try {
      var list = this.loadList();

      console.log("NOTIFICATIONS - adding: " + util.inspect(data));

      notify.id = uuid.v1();
      notify.timestamp = new Date();
      notify.type = type;
      notify.data = data;
      list.notifications[notify.id] = notify;
      this.saveList(list);

      this.emit(notify.type, notify);
      this.emit(this.notifyType.all, notify);
    } catch (e) {
      console.log("error during notificationManger.addNotification: " + e.message);
    } finally {
      locked = false;
    }

    return notify;
  };

  // Remote initiated sync occurred (we received updates from remote PZH/PZP)
  NotificationManager.prototype.updateAfterSync = function(remoteList, syncConfig) {
    var syncList = this.loadList();
    var newItems = [];

    for (var nId in remoteList.notifications) {
      if (remoteList.notifications.hasOwnProperty(nId) && !syncList.notifications.hasOwnProperty(nId)) {
        // Notification not found in sync list - add it.
        var notify = remoteList.notifications[nId];
        console.log("NOTIFICATION - sync adding: " + util.inspect(notify));
        syncList.notifications[nId] = notify;
        newItems.push(notify);
      }
    }

    if (syncConfig){
      if (typeof remoteList.config !== "undefined") {
        syncList.config = remoteList.config;
      } else {
        syncList.config = getEmptyConfig();
      }
    }

    if (syncConfig || newItems.length > 0) {
      this.saveList(syncList);

      for (var n in newItems) {
        this.emit(newItems[n].type, newItems[n]);
        this.emit(this.notifyType.all, newItems[n]);
      }
    }

    return syncConfig || newItems.length > 0;
  };

//  exports.notificationManager = new NotificationManager();
  exports.NotificationManager = NotificationManager;
  exports.PromptHandler = require("./notification-handlers/promptNotificationHandler/promptHandler").Handler;
  exports.TrayHandler = require("./notification-handlers/trayNotificationHandler/trayHandler").Handler;
  exports.EmailHandler = require("./notification-handlers/emailNotificationHandler/emailHandler").Handler;
  exports.APPGPromptHandler = require("./notification-handlers/appgPromptHandler/appgPromptHandler").Handler;
  exports.APPGResponseHandler = require("./notification-handlers/appgResponseHandler/appgResponseHandler").Handler;

})(module.exports);