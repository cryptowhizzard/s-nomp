var async  = require('async');
var net    = require('net');
var bignum = require('bignum');
var algos  = require('stratum-pool/lib/algoProperties.js');
var util   = require('stratum-pool/lib/util.js');

var Crex24  = require('./apiCrex24.js');
var Poloniex = require('./apiPoloniex.js');
var Stex     = require('./apiStex.js');
var Bittrex  = require('./apiBittrex.js');
var Stratum  = require('stratum-pool');

var mysql = require('mysql');


module.exports = function(logger){

    var _this = this;

    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

    var logSystem = 'Profit';

    // 
    // build status tracker for collecting coin market information
    //
    var profitStatus = {};
    var symbolToAlgorithmMap = {};
    Object.keys(poolConfigs).forEach(function(coin){

        var poolConfig = poolConfigs[coin];
        var algo       = poolConfig.coin.algorithm;

        if (!profitStatus.hasOwnProperty(algo)) {
            profitStatus[algo] = {};
        }
        var coinStatus = {
            name: poolConfig.coin.name,
            symbol: poolConfig.coin.symbol,
            difficulty: 0,
            reward: 0,
            exchangeInfo: {}
        };
        profitStatus[algo][poolConfig.coin.symbol] = coinStatus;
        symbolToAlgorithmMap[poolConfig.coin.symbol] = algo;
    });


    // 
    // ensure we have something to switch
    //
    Object.keys(profitStatus).forEach(function(algo){
        if (Object.keys(profitStatus[algo]).length <= 1) {
            delete profitStatus[algo];
            Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                if (symbolToAlgorithmMap[symbol] === algo)
                    delete symbolToAlgorithmMap[symbol];
            });
        }
    });
    if (Object.keys(profitStatus).length == 0){
        logger.debug(logSystem, 'Config', 'No alternative coins to switch to in current config, switching disabled.');
        return;
    }


    // 
    // setup APIs
    //
    var poloApi =  new Poloniex(
        // 'API_KEY',
        // 'API_SECRET'
    );
    var Crex24Api =  new Crex24(
        // 'API_KEY',
        // 'API_SECRET'
    );
    var StexApi =  new Stex(
        // 'API_KEY',
        // 'API_SECRET'
    );

    var bittrexApi =  new Bittrex(
        // 'API_KEY',
        // 'API_SECRET'
    );

    // 
    // market data collection from Poloniex
    //
    this.getProfitDataPoloniex = function(callback){
        async.series([
            function(taskCallback){
                poloApi.getTicker(function(err, data){
                    if (err){
                        taskCallback(err);
                        return;
                    }

                    Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                        var exchangeInfo = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo;
                        if (!exchangeInfo.hasOwnProperty('Poloniex'))
                            exchangeInfo['Poloniex'] = {};
                        var marketData = exchangeInfo['Poloniex'];

                        if (data.hasOwnProperty('BTC_' + symbol)) {
                            if (!marketData.hasOwnProperty('BTC'))
                                marketData['BTC'] = {};

                            var btcData = data['BTC_' + symbol];
                            marketData['BTC'].ask = new Number(btcData.lowestAsk);
                            marketData['BTC'].bid = new Number(btcData.highestBid);
                            marketData['BTC'].last = new Number(btcData.last);
                            marketData['BTC'].baseVolume = new Number(btcData.baseVolume);
                            marketData['BTC'].quoteVolume = new Number(btcData.quoteVolume);
                        }
                        if (data.hasOwnProperty('LTC_' + symbol)) {
                            if (!marketData.hasOwnProperty('LTC'))
                                marketData['LTC'] = {};

                            var ltcData = data['LTC_' + symbol];
                            marketData['LTC'].ask = new Number(ltcData.lowestAsk);
                            marketData['LTC'].bid = new Number(ltcData.highestBid);
                            marketData['LTC'].last = new Number(ltcData.last);
                            marketData['LTC'].baseVolume = new Number(ltcData.baseVolume);
                            marketData['LTC'].quoteVolume = new Number(ltcData.quoteVolume);
                        }
                        // save LTC to BTC exchange rate
                        if (marketData.hasOwnProperty('LTC') && data.hasOwnProperty('BTC_LTC')) {
                            var btcLtc = data['BTC_LTC'];
                            marketData['LTC'].ltcToBtc = new Number(btcLtc.highestBid);
                        }
                    });

                    taskCallback();
                });
            },
            function(taskCallback){
                var depthTasks = [];
                Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                    var marketData = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo['Poloniex'];
                    if (marketData.hasOwnProperty('BTC') && marketData['BTC'].bid > 0){
                        depthTasks.push(function(callback){
                            _this.getMarketDepthFromPoloniex('BTC', symbol, marketData['BTC'].bid, callback) 
                        });
                    }
                    if (marketData.hasOwnProperty('LTC') && marketData['LTC'].bid > 0){
                        depthTasks.push(function(callback){
                            _this.getMarketDepthFromPoloniex('LTC', symbol, marketData['LTC'].bid, callback) 
                        });
                    }
                });

                if (!depthTasks.length){
                    taskCallback();
                    return;
                }
                async.series(depthTasks, function(err){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    taskCallback();
                });
            }
        ], function(err){
            if (err){
                callback(err);
                return;
            }
            callback(null);
        });
        
    };
    this.getMarketDepthFromPoloniex = function(symbolA, symbolB, coinPrice, callback){
        poloApi.getOrderBook(symbolA, symbolB, function(err, data){
            if (err){
                callback(err);
                return;
            }
            var depth = new Number(0);
            var totalQty = new Number(0);
            if (data.hasOwnProperty('bids')){
                data['bids'].forEach(function(order){
                    var price = new Number(order[0]);
                    var limit = new Number(coinPrice * portalConfig.profitSwitch.depth);
                    var qty = new Number(order[1]);
                    // only measure the depth down to configured depth
                    if (price >= limit){
                       depth += (qty * price);
                       totalQty += qty;
                    }
                });
            }

            var marketData = profitStatus[symbolToAlgorithmMap[symbolB]][symbolB].exchangeInfo['Poloniex'];
            marketData[symbolA].depth = depth;
            if (totalQty > 0)
                marketData[symbolA].weightedBid = new Number(depth / totalQty);
            callback();
        });
    };

    this.getProfitDataCrex24 = function(callback){
        async.series([
            function(taskCallback){
                Crex24Api.getTicker(function(err, response){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    if (!Array.isArray(response)){
                        taskCallback(Error('Did not receive data from Crex24. Response: ' + response));
                        return;
                    }

                    Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                        response.forEach(function(market){
                            var exchangeInfo = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo;
                            if (!exchangeInfo.hasOwnProperty('Crex24'))
                                exchangeInfo['Crex24'] = {};

                            var marketData = exchangeInfo['Crex24'];
                            var marketPair = market.instrument.match(/([\w]+)-([\w-_]+)/)
                            market.exchange = marketPair[1]
                            market.code = marketPair[2]
				//console.log('CREX Api Marketpair exchange' + JSON.stringify(market.exchange));
				//console.log('CREX Api Marketpair code ' + JSON.stringify(market.code));
                            //if (market.exchange == 'BTC' && market.code == symbol) {
                                //if (!marketData.hasOwnProperty('BTC'))
                                marketData['BTC'] = {};

                                marketData['BTC'].ask = new Number(market.ask);
				//console.log('CREX Api vraagprijs' + JSON.stringify(market.ask));
                                marketData['BTC'].baseVolume = new Number(market.baseVolume);
                                marketData['BTC'].quoteVolume = new Number(market.quoteVolume);
                                marketData['BTC'].bid = new Number(market.bid);
                                marketData['BTC'].last = new Number(market.last);
                            //}

                        });
                    });
                    taskCallback();
                });
            },
            function(taskCallback){
                var depthTasks = [];
                Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                    var marketData = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo['Crex24'];
                    if (marketData.hasOwnProperty('BTC') && marketData['BTC'].bid > 0){
                        depthTasks.push(function(callback){
                            _this.getMarketDepthFromCrex24('BTC', symbol, marketData['BTC'].bid, callback) 
                        });
                    }
                });

                if (!depthTasks.length){
                    taskCallback();
                    return;
                }
                async.series(depthTasks, function(err){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    taskCallback();
                });
            }
        ], function(err){
            if (err){
                callback(err);
                return;
            }
            callback(null);
        });
    };
    this.getMarketDepthFromCrex24 = function(symbolA, symbolB, coinPrice, callback){

       Crex24Api.getOrderBook(symbolA, symbolB, function(err, response){

            if (err){
                callback(err);
                return;
            }
            var depth = new Number(0);
            if (response.hasOwnProperty('buyLevels')){
                var totalQty = new Number(0);
                //response['result'].forEach(function(order){
		Array.from(response['buyLevels']).forEach(function(order){
                     //console.log('CREX Api Order exchange' + JSON.stringify(order.price));
                     //console.log('CREX Api Order code ' + JSON.stringify(order.volume));
                    var price = new Number(order.price);
                    var limit = new Number(coinPrice * portalConfig.profitSwitch.depth);
                    var qty = new Number(order.volume);
                    // only measure the depth down to configured depth
                    //if (price >= limit){
                       depth += (qty * price);
                       totalQty += qty;
                    //}

                     console.log('CREX Api Order depth' + JSON.stringify(depth));
                     console.log('CREX Api Order qty' + JSON.stringify(totalQty));
                });
            }

            var marketData = profitStatus[symbolToAlgorithmMap[symbolB]][symbolB].exchangeInfo['Crex24'];
            marketData[symbolA].depth = depth;
            if (totalQty > 0)
                marketData[symbolA].weightedBid = new Number(depth / totalQty);
            callback();
        });
    };


   this.getProfitDataStex = function(callback){
        async.series([
            function(taskCallback){
                StexApi.getTicker(function(err, response){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    if (!Array.isArray(response)){
                        taskCallback(Error('Did not receive data from Stex. Response: ' + response));
                        return;
                    }

                    Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                        response.forEach(function(market){
                            var exchangeInfo = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo;
                            if (!exchangeInfo.hasOwnProperty('Stex'))
                                exchangeInfo['Stex'] = {};

                            var marketData = exchangeInfo['Stex'];
                            var marketPair = market.market_name.match(/([\w]+)_([\w-_]+)/)
                            market.exchange = marketPair[1]
                            market.code = marketPair[2]
				//console.log('CREX Api Marketpair exchange' + JSON.stringify(market.exchange));
				//console.log('CREX Api Marketpair code ' + JSON.stringify(market.code));
                            //if (market.exchange == 'BTC' && market.code == symbol) {
                                //if (!marketData.hasOwnProperty('BTC'))
                                marketData['BTC'] = {};

                                marketData['BTC'].ask = new Number(market.ask);
				//console.log('CREX Api vraagprijs' + JSON.stringify(market.ask));
                                marketData['BTC'].baseVolume = new Number(market.vol);
                                marketData['BTC'].quoteVolume = new Number(market.vol);
                                marketData['BTC'].bid = new Number(market.bid);
                                marketData['BTC'].last = new Number(market.last);
                            //}

                        });
                    });
                    taskCallback();
                });
            },
            function(taskCallback){
                var depthTasks = [];
                Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                    var marketData = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo['Stex'];
                    //if (marketData.hasOwnProperty('BTC') && marketData['BTC'].bid > 0){
                        depthTasks.push(function(callback){
                            _this.getMarketDepthFromStex('BTC', symbol, marketData['BTC'].bid, callback) 
                        });
                    //}
                });

                if (!depthTasks.length){
                    taskCallback();
                    return;
                }
                async.series(depthTasks, function(err){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    taskCallback();
                });
            }
        ], function(err){
            if (err){
                callback(err);
                return;
            }
            callback(null);
        });
    };
    this.getMarketDepthFromStex = function(symbolA, symbolB, coinPrice, callback){

       StexApi.getOrderBook(symbolA, symbolB, function(err, response){

            if (err){
                callback(err);
                return;
            }
            var depth = new Number(0);
            if (response.hasOwnProperty('result')){
                var totalQty = new Number(0);
                //response['result'].forEach(function(order){
		//Array.from(response['result']['buy']).forEach(function(order){
		

		var Stex1 = Array.from(response['result']['buy']);

		var Stex = Stex1.slice(0, 1);;	

		Array.from(Stex).forEach(function(order){

                     console.log('STEX Api Order exchange' + JSON.stringify(order.Rate));
                     console.log('STEX Api Order code ' + JSON.stringify(order.Quantity));
                    var price = new Number(order.Rate);
                    var limit = new Number(coinPrice * portalConfig.profitSwitch.depth);
                    var qty = new Number(order.Quantity);
                    // only measure the depth down to configured depth
                    //if (price >= limit){
                       depth += (qty * price);
                       totalQty += qty;
                    //}

                     console.log('STEX Api Order depth' + JSON.stringify(depth));
                     console.log('STEX Api Order qty' + JSON.stringify(totalQty));
                });
            }

            var marketData = profitStatus[symbolToAlgorithmMap[symbolB]][symbolB].exchangeInfo['Stex'];
            marketData[symbolA].depth = depth;
            if (totalQty > 0)
                marketData[symbolA].weightedBid = new Number(depth / totalQty);
            callback();
        });
    };


    this.getProfitDataBittrex = function(callback){
        async.series([
            function(taskCallback){
                bittrexApi.getTicker(function(err, response){
                    if (err || !response.result){
                        taskCallback(err);
                        return;
                    }
                    if (!Array.isArray(response.result)){
                        taskCallback(Error('Did not receive data from Bittrex. Response: ' + response));
                        return;
                    }

                    Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                        response.result.forEach(function(market){
                            var exchangeInfo = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo;
                            if (!exchangeInfo.hasOwnProperty('Bittrex'))
                                exchangeInfo['Bittrex'] = {};

                            var marketData = exchangeInfo['Bittrex'];
                            var marketPair = market.MarketName.match(/([\w]+)-([\w-_]+)/)
                            market.exchange = marketPair[1]
                            market.code = marketPair[2]
                            if (market.exchange == 'BTC' && market.code == symbol) {
                                if (!marketData.hasOwnProperty('BTC'))
                                    marketData['BTC'] = {};

                                marketData['BTC'].last = new Number(market.Last);
                                marketData['BTC'].baseVolume = new Number(market.BaseVolume);
                                marketData['BTC'].quoteVolume = new Number(market.BaseVolume / market.Last);
                                marketData['BTC'].ask = new Number(market.Ask);
                                marketData['BTC'].bid = new Number(market.Bid);
                            }

                            if (market.exchange == 'LTC' && market.code == symbol) {
                                if (!marketData.hasOwnProperty('LTC'))
                                    marketData['LTC'] = {};

                                marketData['LTC'].last = new Number(market.Last);
                                marketData['LTC'].baseVolume = new Number(market.BaseVolume);
                                marketData['LTC'].quoteVolume = new Number(market.BaseVolume / market.Last);
                                marketData['LTC'].ask = new Number(market.Ask);
                                marketData['LTC'].bid = new Number(market.Bid);
                            }

                        });
                    });
                    taskCallback();
                });
            },
            function(taskCallback){
                var depthTasks = [];
                Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                    var marketData = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo['Bittrex'];
                    if (marketData.hasOwnProperty('BTC') && marketData['BTC'].bid > 0){
                        depthTasks.push(function(callback){
                            _this.getMarketDepthFromBittrex('BTC', symbol, marketData['BTC'].bid, callback) 
                        });
                    }
                    if (marketData.hasOwnProperty('LTC') && marketData['LTC'].bid > 0){
                        depthTasks.push(function(callback){
                            _this.getMarketDepthFromBittrex('LTC', symbol, marketData['LTC'].bid, callback) 
                        });
                    }
                });

                if (!depthTasks.length){
                    taskCallback();
                    return;
                }
                async.series(depthTasks, function(err){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    taskCallback();
                });
            }
        ], function(err){
            if (err){
                callback(err);
                return;
            }
            callback(null);
        });
    };
    this.getMarketDepthFromBittrex = function(symbolA, symbolB, coinPrice, callback){
        bittrexApi.getOrderBook(symbolA, symbolB, function(err, response){
            if (err){
                callback(err);
                return;
            }
            var depth = new Number(0);
            if (response.hasOwnProperty('result')){
                var totalQty = new Number(0);
                response['result'].forEach(function(order){
                    var price = new Number(order.Rate);
                    var limit = new Number(coinPrice * portalConfig.profitSwitch.depth);
                    var qty = new Number(order.Quantity);
                    // only measure the depth down to configured depth
                    if (price >= limit){
                       depth += (qty * price);
                       totalQty += qty;
                    }
                });
            }

            var marketData = profitStatus[symbolToAlgorithmMap[symbolB]][symbolB].exchangeInfo['Bittrex'];
            marketData[symbolA].depth = depth;
            if (totalQty > 0)
                marketData[symbolA].weightedBid = new Number(depth / totalQty);
            callback();
        });
    };


    this.getCoindDaemonInfo = function(callback){
        var daemonTasks = [];
        Object.keys(profitStatus).forEach(function(algo){
            Object.keys(profitStatus[algo]).forEach(function(symbol){
                var coinName = profitStatus[algo][symbol].name;
                var poolConfig = poolConfigs[coinName];
                var daemonConfig = poolConfig.paymentProcessing.daemon;
                daemonTasks.push(function(callback){
                    _this.getDaemonInfoForCoin(symbol, daemonConfig, callback)
                });
            });
        });

        if (daemonTasks.length == 0){
            callback();
            return;
        }
        async.series(daemonTasks, function(err){
            if (err){
                callback(err);
                return;
             }
             callback(null);
        });
    };
    this.getDaemonInfoForCoin = function(symbol, cfg, callback){
        var daemon = new Stratum.daemon.interface([cfg], function(severity, message){
            logger[severity](logSystem, symbol, message);
            callback(null); // fail gracefully for each coin
        });


        daemon.cmd('getblocktemplate', [{"capabilities": [ "coinbasetxn", "workid", "coinbase/append" ]}], function(result) {
            if (result[0].error != null) {
                logger.error(logSystem, symbol, 'Error while reading daemon info: ' + JSON.stringify(result[0]));
                callback(null); // fail gracefully for each coin
                return;
            }
            var coinStatus = profitStatus[symbolToAlgorithmMap[symbol]][symbol];
            var response = result[0].response;

            // some shitcoins dont provide target, only bits, so we need to deal with both
            var target = response.target ? bignum(response.target, 16) : util.bignumFromBitsHex(response.bits);
            coinStatus.difficulty = parseFloat((diff1 / target.toNumber()).toFixed(9));
            logger.debug(logSystem, symbol, 'difficulty is ' + coinStatus.difficulty);

            coinStatus.reward = response.coinbasevalue / 100000000;

	    if (symbol.includes('zer')) { coinStatus.reward = "9.9"; }
	    if (symbol.includes('vdl')) { coinStatus.reward = "4.8"; }
	    if (symbol.includes('safe')) { coinStatus.reward = "4"; }
	    if (symbol.includes('genx')) { coinStatus.reward = "350"; }

            logger.debug(logSystem, symbol, 'Reward is ' + coinStatus.reward);
            callback(null);
        });
    };


    this.getMiningRate = function(callback){
        var daemonTasks = [];
        Object.keys(profitStatus).forEach(function(algo){
            Object.keys(profitStatus[algo]).forEach(function(symbol){
                var coinStatus = profitStatus[symbolToAlgorithmMap[symbol]][symbol];
                coinStatus.blocksPerMhPerHour = 86400 / ((coinStatus.difficulty * Math.pow(2,32)) / (1 * 1000 * 1000));
                coinStatus.coinsPerMhPerHour = coinStatus.reward * coinStatus.blocksPerMhPerHour;
                logger.debug(logSystem, symbol, 'blocks per hour is ' + coinStatus.blocksPerMhPerHour);
                logger.debug(logSystem, symbol, 'coins per hour is ' + coinStatus.coinsPerMhPerHour);
            });
        });
        callback(null);
    };


    this.switchToMostProfitableCoins = function() {
        Object.keys(profitStatus).forEach(function(algo) {
            var algoStatus = profitStatus[algo];

            var bestExchange;
            var bestCoin;
            var bestBtcPerMhPerHour = 0;

            Object.keys(profitStatus[algo]).forEach(function(symbol) {
                var coinStatus = profitStatus[algo][symbol];

                Object.keys(coinStatus.exchangeInfo).forEach(function(exchange){
                    var exchangeData = coinStatus.exchangeInfo[exchange];
                    if (exchangeData.hasOwnProperty('BTC') && exchangeData['BTC'].hasOwnProperty('weightedBid')){
                        var btcPerMhPerHour = exchangeData['BTC'].weightedBid * coinStatus.coinsPerMhPerHour;
                	logger.debug(logSystem, symbol, 'Bid is ' + exchangeData['BTC'].weightedBid);
                        if (btcPerMhPerHour > bestBtcPerMhPerHour){
                            bestBtcPerMhPerHour = btcPerMhPerHour;
                            bestExchange = exchange;
                            bestCoin = profitStatus[algo][symbol].name;
                        }
                        coinStatus.btcPerMhPerHour = btcPerMhPerHour;
                        logger.debug(logSystem, 'CALC', 'BTC/' + symbol + ' on ' + exchange + ' with ' + coinStatus.btcPerMhPerHour.toFixed(8) + ' BTC/day per Mh/s');
                    }
                    if (exchangeData.hasOwnProperty('LTC') && exchangeData['LTC'].hasOwnProperty('weightedBid')){
                        var btcPerMhPerHour = (exchangeData['LTC'].weightedBid * coinStatus.coinsPerMhPerHour) * exchangeData['LTC'].ltcToBtc;
                        if (btcPerMhPerHour > bestBtcPerMhPerHour){
                            bestBtcPerMhPerHour = btcPerMhPerHour;
                            bestExchange = exchange;
                            bestCoin = profitStatus[algo][symbol].name;
                        }
                        coinStatus.btcPerMhPerHour = btcPerMhPerHour;
                        logger.debug(logSystem, 'CALC', 'LTC/' + symbol + ' on ' + exchange + ' with ' + coinStatus.btcPerMhPerHour.toFixed(8) + ' BTC/day per Mh/s');
                    }
                });
            });
            logger.debug(logSystem, 'RESULT', 'Best coin for ' + algo + ' is ' + bestCoin + ' on ' + bestExchange + ' with ' + bestBtcPerMhPerHour.toFixed(8) + ' BTC/day per Mh/s');


            var client = net.connect(portalConfig.cliPort, function () {
                client.write(JSON.stringify({
                    command: 'coinswitch',
                    params: [bestCoin],
                    options: {algorithm: algo}
                }) + '\n');
            }).on('error', function(error){
                if (error.code === 'ECONNREFUSED')
                    logger.error(logSystem, 'CLI', 'Could not connect to NOMP instance on port ' + portalConfig.cliPort);
                else
                    logger.error(logSystem, 'CLI', 'Socket error ' + JSON.stringify(error));
            });

        });
    };


    var checkProfitability = function(){
        logger.debug(logSystem, 'Check', 'Collecting profitability data.');

        profitabilityTasks = [];
        if (portalConfig.profitSwitch.usePoloniex)
            profitabilityTasks.push(_this.getProfitDataPoloniex);

        if (portalConfig.profitSwitch.useCrex24)
            profitabilityTasks.push(_this.getProfitDataCrex24);

        if (portalConfig.profitSwitch.useStex)
            profitabilityTasks.push(_this.getProfitDataStex);

        if (portalConfig.profitSwitch.useBittrex)
            profitabilityTasks.push(_this.getProfitDataBittrex);

        profitabilityTasks.push(_this.getCoindDaemonInfo);
        profitabilityTasks.push(_this.getMiningRate);

        // has to be series 
        async.series(profitabilityTasks, function(err){
            if (err){
                logger.error(logSystem, 'Check', 'Error while checking profitability: ' + err);
                return;
            }
            //
            // TODO offer support for a userConfigurable function for deciding on coin to override the default
            // 
            _this.switchToMostProfitableCoins();
        });
    };
    setInterval(checkProfitability, portalConfig.profitSwitch.updateInterval * 1000);

};
