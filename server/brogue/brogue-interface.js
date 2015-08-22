// Class owns communication with a single? brogue socket
// Needs a wrapper class to control its lifecycle then

var events = require('events');
var unixdgram = require('unix-dgram');
var childProcess = require('child_process');

var config = require('../config');
var path = require('path');
var fs = require('fs');

var SERVER_SOCKET = 'server-socket';
var CLIENT_SOCKET = 'client-socket';

var CELL_MESSAGE_SIZE = 10;

var EVENT_BYTE_FLAG = 254;
var EVENT_DATA_OFFSET = 2;

var STATUS_BYTE_FLAG = 255;
var STATUS_DATA_OFFSET = 2;

var MOUSE_INPUT_SIZE = 5;
var KEY_INPUT_SIZE = 5;

var SCREEN_REFRESH = 50;

var GAMEOVER_QUIT = 0;
var GAMEOVER_DEATH = 1;
var GAMEOVER_VICTORY = 2;
var GAMEOVER_SUPERVICTORY = 3;

function BrogueInterface(username) {
    this.username = username;
    this.dataRemainder = new Buffer(0);
    this.brogueEvents = new events.EventEmitter();

    this.disconnected = false;
}

BrogueInterface.prototype.addDataListener = function(listener) {
    this.brogueEvents.on('data', listener);
};

BrogueInterface.prototype.addQuitListener = function(listener) {
    this.brogueEvents.on('quit', listener);
};

BrogueInterface.prototype.addErrorListener = function(listener) {
    this.brogueEvents.on('error', listener);
};

BrogueInterface.prototype.addStatusListener = function(listener) {
    this.brogueEvents.on('status', listener);
};

BrogueInterface.prototype.addEventListener = function(listener) {
    this.brogueEvents.on('event', listener);
};

BrogueInterface.prototype.removeDataListener = function(listener) {
    this.brogueEvents.removeListener('data', listener);
};

BrogueInterface.prototype.removeStatusListener = function(listener) {
    this.brogueEvents.removeListener('status', listener);
};

BrogueInterface.prototype.removeQuitListener = function(listener) {
    this.brogueEvents.removeListener('quit', listener);
};

BrogueInterface.prototype.removeErrorListener = function(listener) {
    this.brogueEvents.removeListener('error', listener);
};

BrogueInterface.prototype.removeEventListener = function(listener) {
    this.brogueEvents.removeListener('event', listener);
};

BrogueInterface.prototype.sendRefreshScreen = function(callback) {

    var messageArray = new Buffer(5);
    messageArray[0] = SCREEN_REFRESH;
    console.log("sending refresh");
    this.sendToBrogue(messageArray, callback);
};

BrogueInterface.prototype.sendToBrogue = function(message, callback) {

    //Send message to socket, if connected
    var messageLength = message.length;

    if (this.brogueSocket) {
        this.brogueSocket.send(message, 0, messageLength, this.getChildWorkingDir() + "/" + SERVER_SOCKET);
        if(callback) {
            callback(null);
        }
    }
    else {
        if(callback) {
            callback(new Error("Socket not connected"));
        }
    }
};

BrogueInterface.prototype.handleIncomingBinaryMessage = function(message, callback) {

    //Movement command from browser

    var controlValue = message.readUInt8(0);
    var messageLength = message.length;
    var ctrlCheck;
    var shiftCheck;
    var isValid;

    if (controlValue === 0) { // key input
        ctrlCheck = message.readUInt8(3);
        shiftCheck = message.readUInt8(4);
        isValid = (messageLength === KEY_INPUT_SIZE) &&
            (ctrlCheck === 0 || ctrlCheck === 1) &&
            (shiftCheck === 0 || shiftCheck === 1);
    }
    else if (controlValue >= 1 && controlValue <= 5) { // mouse input
        ctrlCheck = message.readUInt8(3);
        shiftCheck = message.readUInt8(4);
        isValid = (messageLength === MOUSE_INPUT_SIZE) &&
            (ctrlCheck === 0 || ctrlCheck === 1) &&
            (shiftCheck === 0 || shiftCheck === 1);
    }

    if (!isValid) {
        callback(new Error("Invalid mouse or key input: " + JSON.stringify(message)));
        return;
    }

    this.sendToBrogue(message, callback);
};


BrogueInterface.prototype.getChildWorkingDir = function () {
    return config.path.GAME_DATA_DIR + this.username;
},


BrogueInterface.prototype.start = function () {

    console.log("BrogueInterface.start");

    var childWorkingDir = this.getChildWorkingDir();
    var args = ["--no-menu"]; // the flames on the brogue menu will crash most clients since it sends too much data at once

    /*
    //TODO: paths containing data (i.e. seeded mode etc.)
    if (data) {
        if (data.savedGame) {
            var savedGamePath = path.normalize(childWorkingDir + "/" + data.savedGame);
            fs.access(savedGamePath, fs.F_OK, function (err) {
                if (err) {
                    self.controllers.error.send("Saved Game Not Found: '" + data.savedGame + "' does not exist");
                    return;
                }

                args.push("-o");
                args.push(data.savedGame);

                self.spawnChildProcess(args, childWorkingDir);
            });
        }
        else if (data.seed || data.seed === ""){
            var seed = parseInt(data.seed, 10);

            if (isNaN(seed) || seed < 1 || seed > 4294967295){
                self.sendMessage("seed", {
                    result : "fail",
                    data : "Please enter a numerical seed between 1 and 4294967295"
                });
                return;
            }

            self.sendMessage("seed", {
                result : "success"
            });

            args.push("-s");
            args.push(seed);

            this.spawnChildProcess(args, childWorkingDir);
        }
        else{
            this.controllers.error.send("Message data incorrectly set: " + JSON.stringify(data));
        }
    }
    else {
    */
    //Support reconnect

    //Test if we can send to server socket, if so, no need to spawn a new process, just attach
    //This may happen on first connect after server restart, for example

    try {

        var sendBuf = new Buffer(5);
        sendBuf[0] = SCREEN_REFRESH;

        this.brogueSocket = unixdgram.createSocket('unix_dgram');

        this.brogueSocket.send(sendBuf, 0, 5, this.getChildWorkingDir() + "/" + SERVER_SOCKET, function () {
            console.error("ok to connect to socket - callback"); //TODO: remove
        });

        //Okay to connect through socket to running process
        this.attachChildProcess();
    }
    catch(e) {
        //TODO: remove debug
        console.error("failed to connect to socket, spawning new process " + e);

        this.spawnChildProcess(args, childWorkingDir);
    }
};

BrogueInterface.prototype.spawnChildProcess = function (args, childWorkingDir) {
    var options = {
        cwd: childWorkingDir,
        detached: true,
        stdio: 'ignore'
    };
    this.brogueChild = childProcess.spawn(config.path.BROGUE, args, options);
    this.attachChildProcess();
};

BrogueInterface.prototype.attachChildProcess = function() {
    this.attachChildEvents();
};

BrogueInterface.prototype.attachChildEvents = function () {

    var self = this;

    try { fs.unlinkSync(this.getChildWorkingDir() + "/" + CLIENT_SOCKET); } catch (e) { /* swallow */ }

    var client_read = unixdgram.createSocket('unix_dgram');
    client_read.on('message', function(data, rinfo) {

        //Callback when receiving data on the socket from brogue

        //console.error('data: (%d, %d) -> %s', data[0], data[1], String.fromCharCode(data[3]));

        //Speed debugging
        //var d = new Date();
        //console.error(d.getTime());

        // Ensure that we send out data in chunks divisible by CELL_MESSAGE_SIZE and save any left over for the next data event
        // While it would be more efficient to accumulate all the data here on the server, I want the client to be able to start processing this data as it is being returned.
        var dataLength = data.length;

        //console.error(dataLength);

        var remainderLength = self.dataRemainder.length;
        var numberOfCellsToSend = (dataLength + remainderLength) / CELL_MESSAGE_SIZE | 0;  // |0 is still 2x faster than Math.floor or parseInt
        var sizeOfCellsToSend = numberOfCellsToSend * CELL_MESSAGE_SIZE;
        var newReminderLength = dataLength + remainderLength - sizeOfCellsToSend;

        //fill the data to send
        self.dataAccumulator = new Buffer(sizeOfCellsToSend);
        self.dataRemainder.copy(self.dataAccumulator);
        data.copy(self.dataAccumulator, remainderLength, 0, dataLength - newReminderLength);

        //save the remaining data for next time
        self.dataRemainder = new Buffer(newReminderLength);
        data.copy(self.dataRemainder, 0, dataLength - newReminderLength, dataLength);

        //check for status updates in data and update user object.
        for (var i = 0; i < sizeOfCellsToSend; i += CELL_MESSAGE_SIZE){
            if (self.dataAccumulator[i] === STATUS_BYTE_FLAG){
                var updateFlag = self.dataAccumulator[i + STATUS_DATA_OFFSET];

                // We need to send 4 bytes over as unsigned long.  JS bitwise operations force a signed long, so we are forced to use a float here.
                var updateValue =
                    self.dataAccumulator[i + STATUS_DATA_OFFSET + 1] * 16777216 +
                    self.dataAccumulator[i + STATUS_DATA_OFFSET + 2] * 65536 +
                    self.dataAccumulator[i + STATUS_DATA_OFFSET + 3] * 256 +
                    self.dataAccumulator[i + STATUS_DATA_OFFSET + 4];

                self.brogueEvents.emit('status', {flag: updateFlag, value: updateValue});

                //Remove this status update from the dataAccumulator
                if(i + CELL_MESSAGE_SIZE < self.dataAccumulator.length) {
                    self.dataAccumulator.copy(self.dataAccumulator, i, i + CELL_MESSAGE_SIZE);
                }
            }
            else if(self.dataAccumulator[i] === EVENT_BYTE_FLAG) {
                var eventId = self.dataAccumulator[i + EVENT_DATA_OFFSET];
                console.log("EVENT found");

                // We need to send bytes over as unsigned long.  JS bitwise operations force a signed long, so we are forced to use a float here.
                var eventData1 =
                    self.dataAccumulator[i + EVENT_DATA_OFFSET + 1] * 256 +
                    self.dataAccumulator[i + EVENT_DATA_OFFSET + 2];

                var eventData2 =
                    self.dataAccumulator[i + EVENT_DATA_OFFSET + 3] * 256 +
                    self.dataAccumulator[i + EVENT_DATA_OFFSET + 4];

                var eventStr = self.dataAccumulator.slice(i + EVENT_DATA_OFFSET + 5, 100 - 4 - EVENT_DATA_OFFSET).toString('utf8');

                var eventData = {
                    eventId: eventId,
                    data1: eventData1,
                    data2: eventData2,
                    message: eventStr
                };

                self.processBrogueEvents(self, eventData);

                self.brogueEvents.emit('event', eventData);

                //Remove this status update from the dataAccumulator
                if (i + CELL_MESSAGE_SIZE < self.dataAccumulator.length) {
                    self.dataAccumulator.copy(self.dataAccumulator, i, i + CELL_MESSAGE_SIZE);
                }
            }
        }

        self.brogueEvents.emit('data', self.dataAccumulator);
    });

    client_read.on('error', function(err) {
        console.error('Error when reading from client socket' + err);
        //Not identified any cases where this can happen yet but assume it's terminal
        self.disconnected = true;
        self.brogueEvents.emit('error', 'Error when reading from client socket');
    });

    client_read.bind(this.getChildWorkingDir() + "/" + CLIENT_SOCKET);

    //Server write socket
    //May have already been connected in the test above
    if(!this.brogueSocket) {
        this.brogueSocket = unixdgram.createSocket('unix_dgram');
    }

    this.brogueSocket.on('error', function(err) {
        console.error('Error when writing to client socket: ' + err);
        //This occurs when we connected to an orphaned brogue process and it exits
        //Therefore we set ourselves into an ended state so a new game can be started
        self.disconnected = true;

        self.brogueEvents.emit('error', 'Error when writing to client socket');
    });

    //Not applicable when connecting to an orphaned process
    if(self.brogueChild) {

        self.brogueChild.on('exit', function (code) {
            // go back to lobby in the event something happens to the child process
            self.disconnectBrogue(self);
            console.log('Brogue Process exiting');

            self.brogueEvents.emit('quit');
        });

        self.brogueChild.on('error', function (err) {
            self.killBrogue(self);
            self.disconnectBrogue(self);

            self.brogueEvents.emit('error', 'Message could not be sent to brogue process - Error: ' + err);
        });
    }
};

BrogueInterface.prototype.killBrogue = function(self) {
    if(self.brogueChild) {
        self.brogueChild.kill();
    }
};

BrogueInterface.prototype.disconnectBrogue = function(self) {
    self.brogueChild = null;
    self.brogueSocket = null;
    self.disconnected = true;
};

BrogueInterface.prototype.processBrogueEvents = function(self, eventData) {
    //Analyse brogue messages and do suitable processing, before passing back to the controller
    console.log("Processing brogue events in interface");

    //Kill the brogue process on quit (save a keypress and make sure it dies)
    if(eventData.eventId === GAMEOVER_QUIT ||
        eventData.eventId === GAMEOVER_DEATH ||
        eventData.eventId === GAMEOVER_VICTORY ||
        eventData.eventId === GAMEOVER_SUPERVICTORY) {

        console.log("Killing brogue on quit.");

        self.killBrogue(self);
        self.disconnectBrogue(self);
        self.brogueEvents.emit('quit');
    }
};

module.exports = BrogueInterface;