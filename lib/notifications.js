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

    eventEmitter.call(_self);

    _self.notifyType = {
      all: "all",
      notification: "notification",
      permissionRequest: "permissionRequest",
      permissionResponse: "permissionResponse",
      connectionRequest: "connectionRequest",
      appgTransaction: "appgTransaction",
      appgTransactionResponse: "appgTransactionResponse",
      sync: "sync"
    };

    _self.notificationHandlers = {};

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

    _self.createNotificationHandlers();
  };

  NotificationManager.prototype.addPZPHandler = function(handlerName, handlerClass, entName, createIfMissing) {
    var _self = this;
    var create = false;
    var handler;
    if (_self.notificationHandlers.hasOwnProperty(handlerName)) {
      _self.notificationHandlers[handlerName].removeNotify();
      delete _self.notificationHandlers[handlerName];
    }
    var notificationConfig = _self.getConfig();
    if (notificationConfig.hasOwnProperty(handlerName) && notificationConfig[handlerName].hasOwnProperty(entName)) {
      create = notificationConfig[handlerName][entName] === true;
    } else {
      create = typeof createIfMissing !== "undefined" && createIfMissing === true;
    }
    if (create) {
      handler = new handlerClass(_self,notificationConfig[handlerName]);
      _self.notificationHandlers[handlerName] = handler;
      console.log(">>>>>> started " + handlerName + " notification handler");
    }

    return handler;
  }

  NotificationManager.prototype.createNotificationHandlers = function() {
    var _self = this;

    var utilities = require("webinos-utilities");

    // Create notification handlers.
    var notificationConfig = _self.getConfig();
    if (typeof _self.pzh === "undefined") {
      // Running on PZP - get the pzp name to look-up config values.
      utilities.webinosId.fetchWebinosName("Pzp",null, function(entName) {
        // Only issue prompt and tray notifications on PZPs
        _self.addPZPHandler("promptNotification", utilities.webinosNotifications.PromptHandler, entName, true);
        _self.addPZPHandler("appgPromptNotification", utilities.webinosNotifications.APPGPromptHandler, entName);
        _self.addPZPHandler("trayNotification", utilities.webinosNotifications.TrayHandler, entName);
      });
    } else {
        // Only issue e-mail, SMS and voice notifications from PZH.
        if (_self.notificationHandlers.hasOwnProperty("appgEmailNotification")) {
          _self.notificationHandlers["appgEmailNotification"].removeNotify();
          delete _self.notificationHandlers["appgEmailNotification"];
        }
        if (notificationConfig.appgEmailNotification && notificationConfig.appgEmailNotification.hasOwnProperty("auth") && notificationConfig.appgEmailNotification.hasOwnProperty("email")) {
          _self.notificationHandlers["appgEmailNotification"] = new utilities.webinosNotifications.APPGEmailHandler(_self,notificationConfig.appgEmailNotification);
          console.log(">>>>>> started appg transaction email notification handler");
        }
        _self.notificationHandlers["appgResponseHandler"] = new utilities.webinosNotifications.APPGResponseHandler(_self);
        console.log(">>>>>> started appg transaction response handler");
    }
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

      if (syncConfig) {
        this.createNotificationHandlers();
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
  exports.APPGEmailHandler = require("./notification-handlers/appgEmailHandler/appgEmailHandler").Handler;

})(module.exports);