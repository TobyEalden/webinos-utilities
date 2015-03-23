(function(exports) {
  var util = require("util");

  var ActionHandler = function () {
    "use strict";
    var parent = this;
    var logger = require("./logging.js")(__filename);
    var actionProcessors = {};
    var dBs = {};
    var syncPending = false;
    var scheduled = {};
    var scheduleInterval = 10000;
    var uuid = require('node-uuid');

    parent.receivePendingActions = function(receivedMsg) {
      var entityId = receivedMsg.from;
      var actions = receivedMsg.payload.message;
      logger.log("received actions from " + entityId);

      var acks = [];
      for (var i = 0; i < actions.length; i++) {
        var action = actions[i];
        try {
          addActionInternal(action);

          if (actionProcessors.hasOwnProperty(action.type)) {
            for (var p in actionProcessors[action.type]) {
              actionProcessors[action.type][p].call(null, action);
            }
          } else {
            logger.log("No processors for action type: " + action.type);
          }

          // Add to acknowledge list.
          acks.push(action.id);

        } catch (e) {
          // ToDo - acknowledge anyway?
          logger.error("Failure during receivePendingActions: " + e.message);
        }
      }

      if (acks.length > 0) {
        sendAcknowledgments(entityId,acks);
      }
    };

    parent.trackEntity = function(entityId) {
      // Make sure this entity is in the tracking db.
      var actionDb = loadActions();
      var actionTrackingDb = loadActionTracking();

      if (!actionTrackingDb.entities.hasOwnProperty(entityId)) {
        logger.log(parent.getSessionId() + " trackEntity - unknown entity '" + entityId + "' - adding to tracking db");
        actionTrackingDb.entities[entityId] = { pending: {} };
        for (var action in actionDb.actions) {
          actionTrackingDb.entities[entityId].pending[action] = true;
        }

        saveActionTracking();

        triggerSync();
      }
    };

    parent.addAction = function(type, action, payload) {
      var actionData = {
        id: uuid.v1(),
        type: type,
        action: action,
        createdBy: parent.getSessionId(),
        owner: parent.getSessionId(),
        payload: payload,
        timestamp: new Date()
      };

      addActionInternal(actionData);
    };

    parent.actionsAcknowledged = function(receivedMsg) {
      actionsAcknowledgedInternal(receivedMsg.from, receivedMsg.payload.message);
    };

    parent.broadcastActions = function() {
      // Update all entities
      var actionTrackingDb = loadActionTracking();
      var totalSent = 0;
      for (var ent in actionTrackingDb.entities) {
        if (actionTrackingDb.entities.hasOwnProperty(ent) && parent.isConnected(ent) && !scheduled.hasOwnProperty(ent)) {
// TOBY - commented this out - are actions used anywhere?
// Was generating a lot of traffic, esp. for newly enrolled devices...
//          totalSent += sendPendingActions(ent);
        }
      }

      logger.log("broadcastActions sent a total of " + totalSent + " actions");
    };

    parent.registerActionProcessor = function(type, func) {
      if (!actionProcessors.hasOwnProperty(type)) {
        actionProcessors[type] = [];
      }
      actionProcessors[type].push(func);
    };

    function sendPendingActions(entityId) {
      // Send all pending actions to this entity.
      var actionTrackingDb = loadActionTracking();
      var actionDb = loadActions();
      var pending = [];

      if (!actionTrackingDb.entities.hasOwnProperty(entityId)) {
        logger.log("Received update request for unknown entity " + entityId + " sending all actions");
        actionTrackingDb.entities[entityId] = { pending: {} };
        for (var action in actionDb.actions) {
          actionTrackingDb.entities[entityId].pending[action] = true;
        }
        saveActionTracking();
      }

      var deleteList = [];
      for (var action in actionTrackingDb.entities[entityId].pending) {
        if (actionDb.actions.hasOwnProperty(action)) {
          pending.push(actionDb.actions[action]);
        } else {
          logger.log("Missing pending action has been deleted: " + action);
          deleteList.push(action);
        }
      }

      deleteList.forEach(function(action) {
        delete actionTrackingDb.entities[entityId].pending[action];
      });

      if (pending.length > 0) {
        // Sort in ascending timestamp order.
        pending.sort(function(a,b) {
          var aTS = new Date(a.timestamp);
          var bTS = new Date(b.timestamp);
          return aTS < bTS ? -1 : aTS > bTS ? 1 : 0;
        });
        // Limit to sending 10 actions at a time
        pending = pending.slice(0,10);
        logger.log("sending actions to " + entityId);
        sendMessage(entityId, "actionsReceivePending", pending);
      }

      return pending.length;
    }

    function actionsAcknowledgedInternal(entityId, ackList) {
      logger.log("received acks from " + entityId + " " + JSON.stringify(ackList));

      // Remote entity has acknowledged having processing actions.
      var actionTrackingDb = loadActionTracking();
      var actionDb = loadActions();

      // Update action tracking.
      if (actionTrackingDb.entities.hasOwnProperty(entityId)) {
        for (var ack in ackList) {
          var ackId = ackList[ack];

          // Remove pending flag.
          delete actionTrackingDb.entities[entityId].pending[ackId];

          // Add to acknowledged list.
          if (actionDb.actions.hasOwnProperty(ackId)) {
            actionTrackingDb.acks[ackId][entityId] = true;
          } else {
            logger.error("Received acknowledgement for unknown action " + ackId);
          }
        }

        saveActionTracking();

        // If there are still pending actions for this entity, schedule another sync.
        if (Object.keys(actionTrackingDb.entities[entityId].pending).length > 0) {
          scheduleSync(entityId);
        }
      } else {
        logger.error("Unknown entity " + entityId);
      }
    }

    function scheduleSync(entityId) {
      if (!scheduled.hasOwnProperty(entityId)) {
        scheduled[entityId] = setTimeout(function() {
          sendPendingActions(entityId);
          delete scheduled[entityId];
        }, scheduleInterval);
      }
    }

    function addActionInternal(actionData) {
      var actionDb = loadActions();

      actionData.originator = actionData.owner;
      actionData.owner = parent.getSessionId();

      if (actionDb.actions.hasOwnProperty(actionData.id)) {
        logger.log("action already exists: " + actionData.id);
      }
      actionDb.actions[actionData.id] = actionData;
      saveActions();

      // Set up tracking.
      var actionTrackingDb = loadActionTracking();

      // Flag all entities as needing this update.
      for (var ent in actionTrackingDb.entities) {
        // originator does not need to track own entities.
        if (ent !== actionData.originator && actionTrackingDb.entities.hasOwnProperty(ent)) {
          actionTrackingDb.entities[ent].pending[actionData.id] = true;
        }
      }

      // Set up acknowledgement receipts for this action.
      actionTrackingDb.acks[actionData.id] = {};
      actionTrackingDb.acks[actionData.id][actionData.originator] = true;

      saveActionTracking();

      triggerSync();
    }

    function triggerSync() {
      // Queue up broadcast event.
      if (syncPending === false) {
        syncPending = true;
        process.nextTick(function() {
          parent.broadcastActions();
          syncPending = false;
        });
      } else {
        logger.log("triggerSync - sync already pending");
      }
    }

    function sendMessage(entityId, status, msg) {
      try {
        var msg = {
          "type":"prop",
          "from": parent.getSessionId(),
          "to": entityId,
          "payload": {
            "status": status,
            "message":msg
          }
        };

        parent.sendMessage(msg, entityId);
      } catch (e) {
        logger.error("Error sending message: " + e.message);
        logger.error(util.inspect(msg));
      }
    }

    function sendAcknowledgments(entityId,ackList) {
      logger.log("sending acks to " + entityId + " " + JSON.stringify(ackList));
      sendMessage(entityId, "actionAck", ackList);
    }

    function loadActions() {
      if (!dBs.hasOwnProperty("actions")) {
        dBs.actions = new actionHelpers.ActionsDb(parent);
      }
      return dBs.actions.loadDb();
    }

    function saveActions() {
      if (dBs.hasOwnProperty("actions")) {
        dBs.actions.saveDb();
      }
    }

    function loadActionTracking() {
      if (!dBs.hasOwnProperty("actionTracking")) {
        dBs.actionTracking = new actionHelpers.ActionTrackingDb(parent);
      }
      return dBs.actionTracking.loadDb();
    }

    function saveActionTracking() {
      if (dBs.hasOwnProperty("actionTracking")) {
        dBs.actionTracking.saveDb();
      }
    }
  };

  var actionHelpers = function() {
    var path = require("path");
    var fs = require("fs");
    var existsSync = fs.existsSync || path.existsSync;

    var Db = function(zoneEntity, name, empty) {
      this.storeFile = path.join(zoneEntity.getMetaData("webinosRoot"),"userData",name + "_db.json");
      this.empty = empty;
    };

    Db.prototype.loadDb = function() {
      if (typeof this.cache === "undefined") {
        if (existsSync(this.storeFile)) {
          this.cache = JSON.parse(fs.readFileSync(this.storeFile));
        } else {
          this.cache = this.empty;
        }
      }
      return this.cache;
    }

    Db.prototype.saveDb = function() {
      if  (typeof this.cache !== "undefined") {
        fs.writeFileSync(this.storeFile,JSON.stringify(this.cache,null,2));
      }
    }

    var ActionsDb = function(zoneEntity) {
      Db.call(this,zoneEntity,"actions",{ actions: {}});
    }

    util.inherits(ActionsDb, Db);

    var ActionTrackingDb = function(zoneEntity) {
      Db.call(this,zoneEntity,"actionTracking",{ entities: {}, acks: {}});
    }
    util.inherits(ActionTrackingDb, Db);

    return {
      ActionsDb: ActionsDb,
      ActionTrackingDb: ActionTrackingDb
    };
  }();

  exports.ActionHandler = ActionHandler;

}(module.exports));
