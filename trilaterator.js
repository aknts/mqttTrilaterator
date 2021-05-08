var devices = require('./devices');

//use the trilaterator package. nonlinear least squares approach
var trilat = require('trilat');

var trilaterator = {
	//this is where the main processing of the incoming measurements is done
	process: function(measurement, l, txpower, plex, callback){
		//a new measurement arrives, process the new measurement and when done inform for another

		if (measurement.signalArray.length >= 3 || measurement.uid == null){

			for (let i=0;i<measurement.signalArray.length; i++){
				let signal = measurement.signalArray[i];
				//RSSI to distance in meters
				l.info('txpower: '+txpower+', RSSI: '+signal.RSSI+', plex: '+plex);
				let distance = 10^((txpower - signal.RSSI)/(10*plex));
				l.info('Distance is: '+distance);

				//For each signal create a x,y,d array. x,y are the coordinates of the receiver stored in var 'devices'
				for (let j=0;j<devices.length;j++){
					if (devices[j].did == signal.did){
						signal.xyr = [devices[j].lat, devices[j].lon, distance];							
					}
				}
			}

			//collect all signal.xyr in one array
			var xyr = [];

			measurement.signalArray.forEach(function(signal){
				if (typeof signal.xyr !== 'undefined' && signal.xyr){
					xyr.push(signal.xyr);
				} else {
					callback(new Error('Malformed measurement.'));
				}
			});

			//trilaterator
			try {
				var X = trilat(xyr);
				var result = {
					uid: measurement.uid,
					timestamp: measurement.timestamp,
					lat: X[0],
					lon: X[1]
				};
				callback(null, result);
			} catch (err) {
				l.error('Problem in the trilaterator.');
				callback(err);
			}
		} else {
			callback(new Error('Unqualified measurement.'));
		}
	},
};

module.exports = trilaterator;