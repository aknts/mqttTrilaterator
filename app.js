process.title = 'trilaterator';
// Initialization 
// Config
const config = JSON.parse(Buffer.from(require('./config.js'), 'base64').toString());

// Settings
const pid = Date.now();
var mynodeid = config.mynodeid;
var deployment = config.deploymentname;
var broker = config.globalsettings.broker;
var logtopic = mynodeid+'/'+pid+'/log';
var controltopic = mynodeid+'/'+pid+'/control';
var broadcasttopic = mynodeid+'/broadcast';
var datatopic = mynodeid+'/'+pid+'/data';
var previousnode = config.previousnode;
var previousnodecontroltopic = previousnode+'/control';
var pipelinetopic = config.nameid+'/broadcast'
var logmode = config.appsettings.logmode;
var txpower = config.appsettings.txpower;
var plex = config.appsettings.plex;
var mariadb = config.appsettings.mariadb;

// Modules
const mqttmod = require('mqttmod');
const l = require('mqttlogger')(broker, logtopic, mqttmod, logmode);
const trilaterator = require('./trilaterator');
const filter = require('./filter');
var mysql = require('mysql');
var pool  = mysql.createPool({
  connectionLimit : 10,
  host            : mariadb.host,
  port            : mariadb.port,
  user            : mariadb.user,
  password        : mariadb.password
});

// Variables
var readyresponse = '{"node":"'+mynodeid+'","pid":"'+pid+'","deployment":"'+deployment+'","name":"trilaterator","request":"ready"}';
var joinresponse = '{"node":"'+mynodeid+'","pid":"'+pid+'","name":"trilaterator","request":"join"}';
var leavingresponse = '{"node":"'+mynodeid+'","pid":"'+pid+'","name":"trilaterator","request":"leaving"}';
var terminatingresponse = '{"node":"'+mynodeid+'","pid":"'+pid+'","name":"trilaterator","request":"terminating"}';
var init = 0;
var halt = 1;
var appmodules = ['emitter','filter','loadbalancer','trilaterator','aggregator'];
var livemodules = [];
var data = [];

// Functions
function filterRequests(payload){
	try {
		l.info('Testing payload.\r\n'+payload);
		data = JSON.parse(payload);
    } catch (e) {
        l.error('Received not valid JSON.\r\n'+payload);
		return false;
    }
	var requestingNode = data.node;
	var requestingNodeName = data.name;
	if (requestingNode != mynodeid) {
		switch(data.request) {
			case 'ready':
				if (livemodules.length < appmodules.length) {
					var alpha = -1;
					var beta = 0
					for(var i = 0; i < appmodules.length; i++){
						alpha = appmodules.indexOf(requestingNodeName);
						if (alpha > -1) {
							for(var ii = 0; ii < livemodules.length; ii++){
								if (livemodules[ii].name == requestingNodeName) {
									beta = 1;
								}
							}
						}
					}
					if (alpha > -1 && beta == 0) {
						if (requestingNodeName == 'trilaterator') {
							livemodules.push({"node":requestingNode,"pid":data.pid,"name":requestingNodeName});
							mqttmod.send(broker,requestingNode+'/'+data.pid+'/control',readyresponse);
						} else {
							livemodules.push({"node":requestingNode,"name":requestingNodeName});
							mqttmod.send(broker,requestingNode+'/control',readyresponse);
						}
						l.info('Node '+requestingNode+' reported that is ready');
						l.info('Informing the new nodes that local node is ready');
						console.log(livemodules);
					} 
					if (alpha > -1 && beta == 1) {
						l.info('A '+requestingNodeName+' node already exists');
					}
					if (alpha == -1) {
						l.info(requestingNodeName+' node is not valid');
					}
				}
				if (livemodules.length == appmodules.length) {
					if (init == 0 && halt == 1) {
						mqttmod.send(broker,previousnodecontroltopic,joinresponse);
						halt = 0;
						l.info('All modules ready');
					}
					if (init == 1 && halt == 1){
						halt = 2;
						l.info('All modules ready');
					}
					if (requestingNodeName == 'trilaterator' && init == 1 && halt == 0) {
						for(var i = 0; i < livemodules.length; i++){
								if (livemodules[i].name == requestingNodeName && livemodules[i].node == requestingNode && livemodules[i].pid != data.pid) {
									mqttmod.send(broker,requestingNode+'/'+data.pid+'/control',readyresponse);
								}	
						}
					}
				}
			break;
			case 'execute':
				if (init == 0 && halt == 0) {
					mqttmod.send(broker,previousnodecontroltopic,payload);
					init = 1;
					l.info('Starting application');
				} else if (init == 1 && halt == 2) {
					mqttmod.send(broker,previousnodecontroltopic,payload);
					halt = 0;
					l.info('Restarting application');
				} else {
					l.info('Not all modules are loaded');
				}
			break;
			case 'terminating':
				for(var i = 0;i < livemodules.length;i++){ 
					if (livemodules[i].name == requestingNodeName && livemodules[i].node == requestingNode) { 
						switch(requestingNodeName) {
							case 'trilaterator':
								if ( data.pid == livemodules[i].pid) {
									livemodules.splice(i,1);
								}
							break;
							default:
								livemodules.splice(i,1);
						}
						console.log('livemodules');
						console.log(livemodules);
					}
				}
				if (livemodules.length < appmodules.length) {
					l.info('Node '+requestingNode+' reported that is terminating, halt application.');
					halt = 1;
				}
			break;
			default:
				l.info('Didn\'t receive a valid request');
		}
	}
}

function filterResults(payload) {
	if (halt == 0) {
		console.log('Starting to process at: '+Date.now());
		//a new measurement arrives, process the new measurement and when done inform for another
		var results = JSON.parse(payload);
		l.debug('Received a payload for calculation.');
		measurement = filter.removeDuplicates(results);
		l.debug('Result after removing duplicates: ' + JSON.stringify(measurement));
		trilaterator.process(measurement, l, txpower, plex, function(err, result){
			if (err) {
				l.error(err);
			} else {
				if (result){
					sendData(result);
				}
			}
			mqttmod.send(broker,previousnodecontroltopic,joinresponse);
			heapCheck();
		});
	}
}

function sendData (results) {
	l.info('Sending filtered results'+JSON.stringify(results));
	//mqttmod.send(broker,nextnodedatatopic,JSON.stringify(results));
	let q = 'insert into '+mariadb.db+'.messages (uid,lat,lon,timestamp) values ("'+results.uid+'",'+results.lat+','+results.lon+','+results.timestamp+');';
	pool.query(q, function(err, rows, fields) {
		if (err) throw err;
		console.log('Insert data to db');
	});
	console.log('Finished processing at: '+Date.now());
}

function heapCheck () {
	var usage = '';
	const used = process.memoryUsage();
	for (let key in used) {
		usage = usage.concat(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB, `);
		if (key == 'external') {
			usage=usage.slice(0, -2);
			l.info('Heap usage: '+usage);
		}
	}
}

// Begin execution
livemodules.push({"node":mynodeid,"pid":pid.toString(),"name":"trilaterator"});

// Start recieving control MQTT messages
l.info('Started recieving control MQTT messages on '+controltopic+'.');
mqttmod.receive(broker,controltopic,filterRequests);

// Start recieving broadcast control MQTT messages
l.info('Started recieving broadcast MQTT messages on '+broadcasttopic+'.');
mqttmod.receive(broker,broadcasttopic,filterRequests);

// Start recieving data MQTT messages
l.info('Started recieving data MQTT messages on '+datatopic+'.');
mqttmod.receive(broker,datatopic,filterResults);

// Start recieving control MQTT messages
l.info('Started receiving control messages on '+pipelinetopic);
mqttmod.receive(broker,pipelinetopic,filterRequests);

// Inform previous node that you are ready
mqttmod.send(broker,pipelinetopic,readyresponse);


process.on('SIGTERM', function onSigterm () {
	l.info('Got SIGTERM');
	mqttmod.send(broker,previousnodecontroltopic,leavingresponse);
	mqttmod.send(broker,pipelinetopic,terminatingresponse);
	halt == 1;
});
