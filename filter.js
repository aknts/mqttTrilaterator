var filter = {

	//in cases where we have many readings for a use from the same RPI, we keep only one
	removeDuplicates: function(measurement){
		let RPIKey = [];
		let RPIArray = [];
		for (signalReading of measurement.signalArray){
			if (RPIKey[signalReading.did]){
				continue;
			}
			RPIKey[signalReading.did] = true;
			RPIArray.push(signalReading);
		}

		measurement.signalArray = RPIArray;
		
		return measurement;
	},
};

module.exports = filter;