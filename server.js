/* eslint-disable no-console */
require('dotenv').config();

const mongoose = require('mongoose');
const request = require('request-promise');

const connectionString = `mongodb://${process.env.db_write_user}:${process.env.db_write_password}@${
  process.env.db_name
}`;

const measurementSchema = new mongoose.Schema({
  outdoorTemp: mongoose.Schema.Types.Number,
  roomTemp: mongoose.Schema.Types.Number,
  returnTemp: mongoose.Schema.Types.Number,
  calculatedFlowTemp: mongoose.Schema.Types.Number,
  heatMediumFlowTemp: mongoose.Schema.Types.Number,
  electricalAdditionPower: mongoose.Schema.Types.Number,
  created: mongoose.Schema.Types.Number,
});

var Measurement = mongoose.model('Measurement', measurementSchema);

let nextAccessToken = null;
let nextRefreshToken = null;

const getAccessToken = () => {
  if (nextAccessToken !== null) {
    return nextAccessToken;
  }
  return process.env.access_token;
};

const getRefreshToken = () => {
  if (nextRefreshToken !== null) {
    return nextRefreshToken;
  }
  return process.env.refresh_token;
};

const refreshToken = () => {
  const options = {
    url: 'https://api.nibeuplink.com/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    form: {
      grant_type: 'refresh_token',
      client_id: process.env.client_id,
      client_secret: process.env.client_secret,
      refresh_token: getRefreshToken(),
    },
  };

  console.log('Trying to refreshtoken');
  return request
    .post(options)
    .then((response) => {
      const json = JSON.parse(response);
      console.log('Refresh token successfully');
      nextAccessToken = json.access_token;
      nextRefreshToken = json.refresh_token;
    })
    .catch((error) => {
      console.error(`refreshToken::catch ${error.message}`);
    });
};

const callNibeApi = (url) => {
  const options = {
    url,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
    },
  };

  return request
    .get(options)
    .then((response) => {
      const data = JSON.parse(response);
      console.log('Retreived data successfully from Nibe');
      return { data, error: null };
    })
    .catch((error) => {
      console.error(`callNibeApi::catch ${error.message}`);
      return { data: null, error };
    });
};

const print = () => {
  console.log('Pulling data from Nibe');
};

const getRawValueFromParameterId = (allParameters, processId) => {
  const parsedId = parseInt(processId, 10);
  const foundParameter = allParameters.find((parameter) => parameter.parameterId === parsedId);
  return foundParameter !== undefined ? foundParameter.rawValue : null;
};

const getAndStoreMeasurements = () => {
  print();
  refreshToken().then(() => {
    const statusPromise = callNibeApi('https://api.nibeuplink.com/api/v1/systems/58248/serviceinfo/categories/STATUS');
    const system1Promise = callNibeApi(
      'https://api.nibeuplink.com/api/v1/systems/58248/serviceinfo/categories/SYSTEM_1',
    );
    const additionPromise = callNibeApi(
      'https://api.nibeuplink.com/api/v1/systems/58248//serviceinfo/categories/ADDITION',
    );
    Promise.all([statusPromise, system1Promise, additionPromise]).then((promises) => {
      const allParameters = promises.reduce((all, promise) => {
        if (promise.data === null) {
          return allParameters;
        }
        return all.concat(promise.data);
      }, []);
      new Measurement({
        outdoorTemp: getRawValueFromParameterId(allParameters, process.env.outdoor_temp_id),
        roomTemp: getRawValueFromParameterId(allParameters, process.env.room_temp_id),
        returnTemp: getRawValueFromParameterId(allParameters, process.env.return_temp_id),
        calculatedFlowTemp: getRawValueFromParameterId(allParameters, process.env.calculated_flow_temp_id),
        heatMediumFlowTemp: getRawValueFromParameterId(allParameters, process.env.heat_medium_flow_id),
        electricalAdditionPower: getRawValueFromParameterId(allParameters, process.env.electrical_addition_power_id),
        created: new Date().getTime(),
      }).save();
    });
  });
};

const loop = () => {
  setTimeout(() => {
    getAndStoreMeasurements();
    loop();
  }, parseInt(process.env.interval, 10));
};

mongoose.connect(connectionString);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
  getAndStoreMeasurements();
  loop();
});
