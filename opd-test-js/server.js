/*eslint no-console: 0, no-shadow: 0, new-cap: 0, quotes: 0, no-unused-vars: 0*/

var express = require("express");
var app = express();

var xsenv = require("@sap/xsenv");
var hdbext = require("@sap/hdbext");

var bodyParser = require('body-parser');
var https = require('https');
var axios = require('axios');
var async = require("async");

var hanaOptions = xsenv.getServices({
	hana: {
		tag: "hana"
	}
});
app.use(
	hdbext.middleware(hanaOptions.hana)
);
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(bodyParser.json());

var port = process.env.PORT || 3000;
app.listen(port, function () {
	console.info("Listening on port: " + port);
});

function execInsertRailDirection(req, res, vODPTRailDirection, inboundRailDirection) {
	var sql = 'INSERT INTO "opd-test.opd-test-db::tables.RailDirection" VALUES(\'' +
		vODPTRailDirection + '\',\'' + inboundRailDirection + '\')';
	req.db.exec(sql, function (err, results) {
		if (err) {
			res.type("text/plain").status(500).send("ERROR: " + err.toString());
		}
	});
}

function execInsertRailway(req, res, vODPTRailway, inboundRailway) {
	sql = 'INSERT INTO "opd-test.opd-test-db::tables.Railway" VALUES(\'' +
		vODPTRailway + '\',\'' + inboundRailway + '\')';
	req.db.exec(sql, function (err, results) {
		if (err) {
			res.type("text/plain").status(500).send("ERROR: " + err.toString());
		}
	});
}

function execInsertStation(req, res, vODPTRailway, vODPTStation, inboundStation) {
	sql = 'INSERT INTO "opd-test.opd-test-db::tables.Station" VALUES(\'' +
		vODPTRailway + '\',\'' + vODPTStation + '\',\'' + inboundStation + '\')';
	req.db.exec(sql, function (err, results) {
		if (err) {
			res.type("text/plain").status(500).send("ERROR: " + err.toString());
		}
	});
}

function hiraganaAPI(vInboundWord, vOutputType) {
	return new Promise(function (resolve, reject) {
		var options = {
			method: "post",
			url: "https://labs.goo.ne.jp/api/hiragana",
			headers: {
				"Content-Type": "application/json"
			},
			data: {
				"app_id": "0f3b82b8e712998465f2c7848dbaa8af322e826765dcc5e5dcd74c6f360d2595",
				"sentence": vInboundWord,
				"output_type": vOutputType
			}
		};
		axios(options)
			.then(function (apiRes) {
				resolve(apiRes.data.converted);
			})
			.catch(function (apiErr) {
				reject(apiErr);
			});
		//resolve(vInboundWord + " " + vOutputType);
	});
}

async function hiraganaInsert(req, res, vODPTValue1, vODPTValue2, vInboundWord, vOutputType, vInsertTarget) {
	await hiraganaAPI(vInboundWord, vOutputType)
		.then(function (convertedVal) {
			switch (vInsertTarget) {
			case "railway":
				execInsertRailway(req, res, vODPTValue2, convertedVal);
				break;
			case "station":
				execInsertStation(req, res, vODPTValue1, vODPTValue2, convertedVal);
				break;
			case "railDirection":
				execInsertRailDirection(req, res, vODPTValue2, convertedVal);
				break;
			}
		}).catch(function (err) {
			res.type("text/plain").status(500).send("ERROR in " + vInsertTarget + " for " + vODPTValue2 + " " + vInboundWord + ": " + err.toString());
		});
}

async function waitAllForHiraganaInsert(req, res, array, vInsertTarget) {
	switch (vInsertTarget) {
	case "railway":
	case "railDirection":
		await Promise.all(array.map(function (element) {
			return hiraganaInsert(req, res, 0, element["owl:sameAs"], element["dc:title"], "hiragana", vInsertTarget);
		}));
		await Promise.all(array.map(function (element) {
			return hiraganaInsert(req, res, 0, element["owl:sameAs"], element["dc:title"], "katakana", vInsertTarget);
		}));
		res.status(200).json(array.length + " x3 (original, hiragana and katakana) rows insert finished.");
		break;
	case "station":
		// return promise to use waitAllForHiraganaInsertWrapper.
		return new Promise(async function (resolve, reject) {
			await Promise.all(array.map(function (element) {
				return hiraganaInsert(req, res, element.ODPTRailway, element.ODPTStation, element.inboundStation, "hiragana", vInsertTarget);
			}));
			/*await Promise.all(array.map(function (element) {
				return hiraganaInsert(req, res, element.ODPTRailway, element.ODPTStation, element.inboundStation, "katakana", vInsertTarget);
			}));*/
			resolve(array.length);
		});
		break;
	}
}

async function sleep(milliseconds) {
	return new Promise(function (resolve, reject) {
		setTimeout(function () {
			resolve("sleeped for " + milliseconds + " milliseconds");
		}, milliseconds);
	});
}

// execute waitAllForHiraganaInsert with dividing the array by 100.
async function waitAllForHiraganaInsertWrapper(req, res, array, vInsertTarget) {
	for (var i = 0; i < Math.ceil(array.length / 100); i++) {
		var arrayPart = [];
		for (var j = 0; j < 100; j++) {
			if ((100 * i + j) === array.length) {
				break;
			}
			arrayPart.push(array[i * 100 + j]);
		}
		await waitAllForHiraganaInsert(req, res, arrayPart, "station")
			.then(function (promiseVal) {
				console.log(promiseVal);
			}).catch(function (err) {
				res.type("text/plain").status(500).send("ERROR in calling waitAllForHiraganaInsert from warpper: " + err.toString());
			});
		// execute every 3 seconds in order to avoid socket hang up error.
		await sleep(3000);
	}
	res.status(200).json(array);
}

app.post('/Inbound', function (req, res) {
	console.log("Hello!");
	console.log(req.body.conversation.memory.line.value);
	console.log(req.body.conversation.memory.station.value);
	console.log(req.body.conversation.memory.direction.value);
	console.log(req.body.conversation.memory.time.value);
	var InRailway = req.body.conversation.memory.line.value;
	var InStation = req.body.conversation.memory.station.value;
	var InDirection = req.body.conversation.memory.direction.value;
	var InTime = req.body.conversation.memory.time.value;

	var sql = 'SELECT TOP 1 R."odptRailway", S."odptStation", RD."odptRailDirection" ' +
		'FROM "opd-test.opd-test-db::tables.Railway" R ' +
		'INNER JOIN "opd-test.opd-test-db::tables.Station" S ' +
		'ON R."odptRailway" = S."odptRailway" AND R."InboundWord" = \'' + InRailway +
		'\' AND S."InboundWord" = \'' + InStation +
		'\' INNER JOIN "opd-test.opd-test-db::tables.RailDirection" RD ' +
		'ON RD."InboundWord" = \'' + InDirection + '\'';
	req.db.prepare(sql, function (err, statement) {
		if (err) {
			res.type("text/plain").status(500).send("ERROR: " + err.toString());
		}
		//statement.exec([InRailway], function (err, STResult) {
		statement.exec([], function (err, STResult) {
			if (err) {
				res.type("text/plain").status(500).send("ERROR: " + err.toString());
			} else {
				//res.status(200).json(STResult);
				var aclConsumerKey = "d70b73e46ff972f7f4c7aa5f0729cec27739b8a74fcae80925ea074bd60ebb0e";
				var odptRailway = STResult[0].odptRailway;
				var odptStation = STResult[0].odptStation;
				var odptRailDirection = STResult[0].odptRailDirection;
				var odptCalendar = "odpt.Calendar:Weekday";
				var URL = "https://api-tokyochallenge.odpt.org/api/v4/odpt:StationTimetable" +
					"?acl:consumerKey=" + aclConsumerKey +
					"&odpt:railway=" + odptRailway +
					"&odpt:station=" + odptStation +
					"&odpt:railDirection=" + odptRailDirection +
					"&odpt:calendar=" + odptCalendar;

				https.get(URL, function (getRes) {
					var body = "";
					getRes.setEncoding('utf8');
					getRes.on('data', function (chunk) {
						body += chunk;
					});
					getRes.on('end', function () {
						var oBody = JSON.parse(body);
						var odptResult = oBody[0]["odpt:stationTimetableObject"];
						var departureTimes = "";
						odptResult.forEach(function (element) {
							if (element["odpt:departureTime"].indexOf(InTime + ":") !== -1) {
								departureTimes += (element["odpt:departureTime"]) + "、";
							}
						});
						var MY_TEXT = InTime + "時台の電車は、" + departureTimes + "がありまっせ。";
						var httpResponse = {
							"replies": [
								{
									"type": "text",
									"content": MY_TEXT
								}
							]
						};
						console.log("Here");
						console.log(httpResponse);
						res.status(200).json(httpResponse);
					});
				}).on('error', function (err) {
					res.type("text/plain").status(500).send("ERROR: " + err.toString());
				});
			}
		});
	});
});

app.get('/insertRailway', function (req, res) {
	var URL =
		"https://api-tokyochallenge.odpt.org/api/v4/odpt:Railway?acl:consumerKey=d70b73e46ff972f7f4c7aa5f0729cec27739b8a74fcae80925ea074bd60ebb0e";

	https.get(URL, function (getRes) {
		var body = "";
		getRes.setEncoding('utf8');
		getRes.on('data', function (chunk) {
			body += chunk;
		});
		getRes.on('end', function () {
			var oBody = JSON.parse(body);
			oBody.forEach(function (eleRailway) {
				execInsertRailway(req, res, eleRailway["owl:sameAs"], eleRailway["dc:title"]);
			});
			waitAllForHiraganaInsert(req, res, oBody, "railway");
		});
	}).on('error', function (err) {
		res.type("text/plain").status(500).send("ERROR: " + err.toString());
	});
});

app.get('/insertStation', function (req, res) {
	var URL =
		"https://api-tokyochallenge.odpt.org/api/v4/odpt:Railway?acl:consumerKey=d70b73e46ff972f7f4c7aa5f0729cec27739b8a74fcae80925ea074bd60ebb0e";

	https.get(URL, function (getRes) {
		var body = "";
		getRes.setEncoding('utf8');
		getRes.on('data', function (chunk) {
			body += chunk;
		});
		getRes.on('end', function () {
			var oBody = JSON.parse(body);
			var dataArray = [];
			oBody.forEach(function (eleRailway) {
				eleRailway["odpt:stationOrder"].forEach(function (eleStation) {
					execInsertStation(req, res, eleRailway["owl:sameAs"], eleStation["odpt:station"], eleStation["odpt:stationTitle"].ja);
					var data = {
						"ODPTRailway": eleRailway["owl:sameAs"],
						"ODPTStation": eleStation["odpt:station"],
						"inboundStation": eleStation["odpt:stationTitle"].ja
					};
					dataArray.push(data);
				});
			});
			// Use wrapper function to devide the array, otherwise end up socket hang up error.
			waitAllForHiraganaInsertWrapper(req, res, dataArray, "railDirection");
		});
	}).on('error', function (err) {
		res.type("text/plain").status(500).send("ERROR: " + err.toString());
	});
});

app.get('/insertRailDirection', function (req, res) {
	var URL =
		"https://api-tokyochallenge.odpt.org/api/v4/odpt:RailDirection?acl:consumerKey=d70b73e46ff972f7f4c7aa5f0729cec27739b8a74fcae80925ea074bd60ebb0e";

	https.get(URL, function (getRes) {
		var body = "";
		getRes.setEncoding('utf8');
		getRes.on('data', function (chunk) {
			body += chunk;
		});
		getRes.on('end', function () {
			var oBody = JSON.parse(body);
			oBody.forEach(function (element) {
				execInsertRailDirection(req, res, element["owl:sameAs"], element["dc:title"]);
			});
			waitAllForHiraganaInsert(req, res, oBody, "railDirection");
		});
	}).on('error', function (err) {
		res.type("text/plain").status(500).send("ERROR: " + err.toString());
	});
});

app.get('/hiraganaAPITest', function (req, res) {
	var testArray = [0, 1, 2];
	var resultArray = [];
	testArray.forEach(function (element) {
		hiraganaAPI("漢字", "hiragana", function (apiRes, apiErr) {
			if (apiErr) {
				res.type("text/plain").status(500).send("ERROR: " + apiErr.toString());
			}
			resultArray.push(apiRes.data.converted);
		});
	});
	res.status(200).json(resultArray);
});
