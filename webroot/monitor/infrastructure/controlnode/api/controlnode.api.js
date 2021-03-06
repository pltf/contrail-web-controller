/*
 * Copyright (c) 2014 Juniper Networks, Inc. All rights reserved.
 */

var rest = require(process.mainModule.exports["corePath"] +
        '/src/serverroot/common/rest.api'),
    async = require('async'),
    commonUtils = require(process.mainModule.exports["corePath"] +
                          '/src/serverroot/utils/common.utils'),
    logutils = require(process.mainModule.exports["corePath"] +
            '/src/serverroot/utils/log.utils'),
    jsonPath = require('JSONPath').eval,
    appErrors = require(process.mainModule.exports["corePath"] +
                        '/src/serverroot/errors/app.errors'),
    adminApiHelper = require('../../../../common/api/adminapi.helper'),
    urlMod = require('url'),
    nwMonUtils = require('../../../../common/api/nwMon.utils'),
    opApiServer = require(process.mainModule.exports["corePath"] +
            '/src/serverroot/common/opServer.api'),
    infraCmn = require('../../../../common/api/infra.common.api'),
    configApiServer = require(process.mainModule.exports["corePath"] +
            '/src/serverroot/common/configServer.api');

function getControlNodesSummary (req, res, appData)
{
    var nodesHostIp = {'hosts': {}, 'ips': {}};
    var url = '/bgp-routers?detail=true&exclude_back_refs=true&exclude_children=true';
    var resultJSON = [];
    var configData = [], uveData = [];
    var addGen = req.param('addGen');

    configApiServer.apiGet(url, appData,
                           commonUtils.doEnsureExecution(function(err, data) {
        getControlNodeDetailConfigUVEData(data, addGen, appData,
                                          function(err, configUVEData,
                                          bgpRtrCnt) {
            if (null != err) {
                callback(null, []);
                return;
            }
            for (var i = 0; i < bgpRtrCnt; i++) {
                configData[i] = configUVEData[i];
            }
            var cnt = configUVEData.length;
            for (i = bgpRtrCnt; i < cnt; i++) {
                uveData[i - bgpRtrCnt] = configUVEData[i];
            }
            resultJSON =
                infraCmn.checkAndGetSummaryJSON(configData, uveData,
                    ['contrail-control']);
            commonUtils.handleJSONResponse(err, res, resultJSON);
            var nodeCnt = 0;
            try {
                nodeCnt = resultJSON.length;
            } catch(e) {
                nodeCnt = 0;
            }
            for (var i = 0; i < nodeCnt; i++) {
                nodesHostIp['hosts'][resultJSON[i]['name']] = [];
                try {
                    var configIP =
                    resultJSON[i]['value']['ConfigData']['bgp-router']
                                 ['bgp_router_parameters']['address'];
                    nodesHostIp['ips'][configIP] = [];
                } catch(e) {
                    logutils.logger.error("Control Node Config Data Parse " +
                                          "error :" + e);
                }
                var bgpUVEIpsCnt = 0;
                try {
                    var bgpUVEIps =
                        resultJSON[i]['value']['BgpRouterState']['bgp_router_ip_list'];
                    bgpUVEIpsCnt = bgpUVEIps.length;
                } catch(e) {
                    logutils.logger.error("Control Node UVE Data Parse " +
                                          "error :" + e);
                    bgpUVEIpsCnt = 0;
                }
                for (var j = 0; j < bgpUVEIpsCnt; j++) {
                    nodesHostIp['ips'][bgpUVEIps[j]] = [];
                }
            }
            if (nodeCnt > 0) {
                infraCmn.saveNodesHostIPToRedis(nodesHostIp,
                                                global.label.CONTROL_NODE,
                                                function(err) {
                });
            }
        });
    }, global.DEFAULT_CB_TIMEOUT));
}

function getControlNodeDetails (req, res, appData)
{
    var hostName = req.param('hostname');
    var url = '/analytics/uves/control-node/' + hostName + '?flat';
    var resultJSON = {};

    opApiServer.apiGet(url, appData,
                     commonUtils.doEnsureExecution(function(err, data) {
        if ((null != err) || (null == data)) {
            data = {};
            infraCmn.getDataFromConfigNode('bgp-routers', hostName, appData,
                                           data, function(err, resultJSON) {
                commonUtils.handleJSONResponse(err, res, resultJSON);
            });
        } else {
            var postData = {};
            postData['kfilt'] = [hostName + '*:contrail-control*'];
            infraCmn.addGeneratorInfoToUVE(postData, data, hostName,
                                  ['contrail-control'], appData,
                                  function(err, data) {
                infraCmn.getDataFromConfigNode('bgp-routers', hostName, appData,
                                               data, function(err, data) {
                    commonUtils.handleJSONResponse(err, res, data);
                });
            });
        }
    }, global.DEFAULT_CB_TIMEOUT));
}

function getControlNodePeerInfo (req, res, appData)
{
    var hostName = req.param('hostname');
    var dataObjArr = [];

    var reqUrl = '/analytics/uves/bgp-peer/*:' + hostName + ':*';
    commonUtils.createReqObj(dataObjArr, reqUrl,
                             global.HTTP_REQUEST_GET, null, null, null,
                             appData);
    reqUrl = '/analytics/uves/xmpp-peer/' + hostName + ':*?flat';
    commonUtils.createReqObj(dataObjArr, reqUrl,
                             global.HTTP_REQUEST_GET, null, null, null,
                             appData);

    async.map(dataObjArr,
              commonUtils.getAPIServerResponse(opApiServer.apiGet, true),
              function(err, results) {
       var resultJSON = {};
       resultJSON['bgp-peer'] = results[0];
       resultJSON['xmpp-peer'] = results[1];
       commonUtils.handleJSONResponse(err, res, resultJSON);
    });
}

function getControlNodePeerDetails (req, res, appData)
{
    var reqUrl;
    var urlLists = [];
    var resultJSON = [];
    var dataObjArr = [];

    adminApiHelper.getControlNodeList(appData, function(err, configData) {
        if (err || (null == configData)) {
            commonUtils.handleJSONResponse(err, res, null);
            return;
        }
        var len = configData.length;
        for (var i = 0; i < len; i++) {
            reqUrl = '/analytics/uves/bgp-peer/*' + configData[i]['name'] + '*';
            commonUtils.createReqObj(dataObjArr, reqUrl,
                                     global.HTTP_REQUEST_GET, null, null, null,
                                     appData);
        }
        for (i = 0; i < len; i++) {
            reqUrl = '/analytics/uves/xmpp-peer/' + configData[i]['name'] +
                ':*?flat';
            commonUtils.createReqObj(dataObjArr, reqUrl,
                                     global.HTTP_REQUEST_GET, null, null, null,
                                     appData);
        }
        async.map(dataObjArr,
                  commonUtils.getAPIServerResponse(opApiServer.apiGet, true),
                  function(err, results) {
            for (var i = 0; i < len; i++) {
                resultJSON[i] = {};
                resultJSON[i] =
                    processControlNodePeerDetails(configData[i]['name'],
                                                  results[i], results[i + len]);
                resultJSON[i]['host'] = configData[i]['name'];
                resultJSON[i]['ip'] = configData[i]['ip'];
            }
            commonUtils.handleJSONResponse(err, res, resultJSON);
        });
    });
}

function getControlNodePeerPagedInfo (req, res, appData)
{
    var hostName = req.param('hostname');
    var resultJSON = [];
    var urlLists = [];
    var peerList = [];
    var count = req.param('count');
    var lastKey = req.param('lastKey');
    var name = null;
    var dataObjArr = [];

    if (null == count) {
        count = -1;
    } else {
        count = parseInt(count);
    }
    var reqUrl = '/analytics/uves/bgp-peers';
    commonUtils.createReqObj(dataObjArr, reqUrl,
                             null, null, null, null, appData);
    reqUrl = '/analytics/uves/xmpp-peers';
    commonUtils.createReqObj(dataObjArr, reqUrl,
                             null, null, null, null, appData);

    async.map(dataObjArr,
              commonUtils.getAPIServerResponse(opApiServer.apiGet, true),
              function(err, results) {
        if ((null != err) || (null == results)) {
            commonUtils.handleJSONResponse(err, res, resultJSON);
            return;
        }
        if (null != results[0]) {
            var bgpPeerCnt = results[0].length;
            for (var i = 0; i < bgpPeerCnt; i++) {
                try {
                    name = results[0][i]['name'];
                    if (-1 != name.indexOf(':' + hostName + ':')) {
                        peerList.push({'name': name, 'type': 'bgp-peer'});
                    }
                } catch(e) {
                    continue;
                }
            }
        }
        if (null != results[1]) {
            var xmppPeerCnt = results[1].length;
            for (var i = 0; i < xmppPeerCnt; i++) {
                try {
                    name = results[1][i]['name'];
                    if (-1 != name.indexOf(hostName + ':')) {
                        peerList.push({'name': name, 'type': 'xmpp-peer'});
                    }
                } catch(e) {
                    continue;
                }
            }
        }
        peerList.sort(infraCmn.sortUVEList);
        getPagedPeerData(peerList, hostName, count, lastKey, appData, function(err, data) {
            commonUtils.handleJSONResponse(err, res, data);
        });
    });
}

function getControlNodeSandeshRequest (req, res, appData)
{
    var ip = req.param('ip');
    var type = req.param('type');
    var dataObjArr = [];
    var url = null;

    if (type == 'service-chain') {
        url = '/Snh_ShowServiceChainReq?';
    } else if (type == 'multicast-tree') {
        var rtTab = req.param('name');
        if (null == rtTab) {
            url = '/Snh_ShowMulticastManagerReq?';
        } else {
            url = '/Snh_ShowMulticastManagerDetailReq?x=' + rtTab;
        }
    } else if (type == 'routing-inst') {
        var name = req.param('name');
        if (null == name) {
            url = '/Snh_ShowRoutingInstanceReq?name=';
        } else {
            url = '/Snh_ShowRoutingInstanceReq?x=' + name;
        }
    } else if (type == 'static-route') {
        riName = req.param('name');
        if (null == riName) {
            url = '/Snh_ShowStaticRouteReq?ri_name=';
        } else {
            url = '/Snh_ShowStaticRouteReq?ri_name=' + riName;
        }
    }
    var controlNodeRestApi =
        commonUtils.getRestAPIServer(ip, global.SANDESH_CONTROL_NODE_PORT,
                                     global.SANDESH_API);

    commonUtils.createReqObj(dataObjArr, url);
    infraCmn.sendSandeshRequest(req, res, dataObjArr, controlNodeRestApi);
}

function controlNodeExist (configData, bgpHost)
{
    try {
        var cnt = configData['bgp-routers'].length;
    } catch(e) {
        return false;
    }
    for (var i = 0; i < cnt; i++) {
        try {
            var fqName = configData['bgp-routers'][i]['fq_name'];
            var fqNameLen = fqName.length;
            if (bgpHost == configData['bgp-routers'][i]['fq_name'][fqNameLen - 1]) {
                return true;
            }
        } catch(e) {
            continue;
        }
    }
}

function getControlNodeDetailConfigUVEData (configData, addGen, appData, callback)
{
    var len = 0;
    var dataObjArr = [];

    try {
        len = configData['bgp-routers'].length;
    } catch(e) {
        len = 0;
    }
    var filteredConfigData = []
    for (var i = 0; i < len; i++) {
        var type = commonUtils.getValueByJsonPath(configData,'bgp-routers;' + i
                + ';bgp-router;bgp_router_parameters;router_type',null,false);
        if( type != 'bgpaas-client' && type != 'bgpaas-server') {
            filteredConfigData.push(configData['bgp-routers'][i]);
        }
    }
    len = filteredConfigData.length;
    reqUrl = '/analytics/uves/control-node';
    var postData = {};
    postData['cfilt'] = ['BgpRouterState','NodeStatus','ControlCpuState','UVEAlarms'];
    commonUtils.createReqObj(dataObjArr, reqUrl, global.HTTP_REQUEST_POST,
                             postData, opApiServer, null, appData);
    if (null != addGen) {
        var genPostData = {};
        genPostData['kfilt'] = ['*:contrail-control*'];
        genPostData['cfilt'] = ['ModuleClientState:client_info',
                                'ModuleServerState:generator_info'];
        reqUrl = '/analytics/uves/generator';
        commonUtils.createReqObj(dataObjArr, reqUrl, global.HTTP_REQUEST_POST,
                                 genPostData, opApiServer, null, appData);
    }
    async.map(dataObjArr,
              commonUtils.getServerResponseByRestApi(configApiServer, true),
              function(err, results) {
        var resCnt = results.length;
        for (var i = 0; i < resCnt; i++) {
            if (null == results[i]) {
                results[i] = [];
            }
        }
        filteredConfigData = filteredConfigData.concat(results);
        callback(err, filteredConfigData, len);
    });
}

function processBGPPeerDetails (hostname, bgpPeerInfo)
{
    var resultJSON = {};
    var nameArr = [];
    var j = 0;
    resultJSON['bgp-peer'] = [];

    try {
        var cnt = bgpPeerInfo['value'].length;
    } catch(e) {
        return resultJSON;
    }

    for (var i = 0; i < cnt; i++) {
        try {
            nameArr = bgpPeerInfo['value'][i]['name'].split(':');
            if (hostname == nameArr[4]) {
                resultJSON['bgp-peer'][j++] = bgpPeerInfo['value'][i];
            }
        } catch(e) {
            logutils.logger.debug("In processBGPPeerDetails(): JSON Parse error:" +
                                  e);
        }
    }
    return resultJSON;
}

function processXMPPPeerDetails (hostName, xmppPeerInfo)
{
    var resultJSON = {};
    var j = 0;

    resultJSON['xmpp-peer'] = [];
    try {
        var cnt = xmppPeerInfo['value'].length;
    } catch(e) {
        return resultJSON;
    }
    var lastIndex = 0;
    for (var i = 0; i < cnt; i++) {
        try {
            var name = xmppPeerInfo['value'][i]['name'];
            resultJSON['xmpp-peer'][j++] = xmppPeerInfo['value'][i];
        } catch(e) {
            logutils.logger.debug("In processXMPPPeerDetails(): JSON Parse error:"
                                  + e);
        }
    }
    return resultJSON;
}

function processControlNodePeerDetails (hostName, bgpPeerInfo, xmppPeerInfo)
{
    var resultJSON = [];
    bgpPeerInfo = processBGPPeerDetails(hostName, bgpPeerInfo);
    xmppPeerInfo = processXMPPPeerDetails(hostName, xmppPeerInfo);
    resultJSON = bgpPeerInfo;
    for (var key in xmppPeerInfo) {
        resultJSON[key] = xmppPeerInfo[key];
    }
    return resultJSON;
}

function getPagedPeerData (peerList, hostName, count, lastKey, appData, callback)
{
    var resultJSON = {};
    var dataObjArr = [];
    resultJSON['data'] = {};
    resultJSON['data']['bgp-peer'] = {};
    resultJSON['data']['bgp-peer']['value'] = [];
    resultJSON['data']['xmpp-peer'] = {};
    resultJSON['data']['xmpp-peer']['value'] = [];
    resultJSON['lastKey'] = null;
    resultJSON['more'] = false;
    var retLastKey = null;

    var matchStr = 'name';
    var index = nwMonUtils.getnThIndexByLastKey(lastKey, peerList, matchStr);
    if (-2 == index) {
        callback(null, resultJSON);
        null;
    }
    try {
        var cnt = peerList.length;
    } catch(e) {
        callback(null, resultJSON);
        return;
    }
    if (cnt == index) {
        /* We are already at end */
        callback(null, resultJSON);
        return;
    }
    if (-1 == count) {
        totCnt = cnt;
    } else {
        totCnt = index + 1 + count;
    }
    if (totCnt < cnt) {
        retLastKey = peerList[totCnt - 1][matchStr];
    }
    var bgpPostData = {};
    bgpPostData['kfilt'] = [];
    var xmppPostData = {};
    xmppPostData['kfilt'] = [];

    for (var i = index + 1; i < totCnt; i++) {
        if (peerList[i]) {
            if ('bgp-peer' == peerList[i]['type']) {
                bgpPostData['kfilt'].push(peerList[i]['name']);
            }
            if ('xmpp-peer' == peerList[i]['type']) {
                xmppPostData['kfilt'].push(peerList[i]['name']);
            }
        }
    }
    if (bgpPostData['kfilt'].length > 0) {
        var bgpPeerUrl = '/analytics/uves/bgp-peer';
        commonUtils.createReqObj(dataObjArr, bgpPeerUrl,
                                 global.HTTP_REQUEST_POST,
                                 commonUtils.cloneObj(bgpPostData), null, null,
                                 appData);
    }
    if (xmppPostData['kfilt'].length > 0) {
        var xmppPeerUrl = '/analytics/uves/xmpp-peer';
        commonUtils.createReqObj(dataObjArr, xmppPeerUrl,
                                 global.HTTP_REQUEST_POST,
                                 commonUtils.cloneObj(xmppPostData), null, null,
                                 appData);
    }
    if (0 == dataObjArr.length) {
        callback(null, resultJSON);
        return;
    }
    async.map(dataObjArr,
              commonUtils.getServerResponseByRestApi(opApiServer, true),
              function(err, data) {
        if ((null != err) || (null == data)) {
            callback(err, resultJSON);
            return;
        }
        if (bgpPostData['kfilt'].length > 0) {
            bgpArrIdx = 0;
            if (xmppPostData['kfilt'].length > 0) {
                xmppArrIdx = 1;
            } else {
                xmppArrIdx = -1;
            }
        } else {
            bgpArrIdx = -1;
            if (xmppPostData['kfilt'].length > 0) {
                xmppArrIdx = 0;
            } else {
                xmppArrIdx = -1;
            }
        }
        if (-1 != bgpArrIdx) {
            resultJSON['data']['bgp-peer'] = data[bgpArrIdx];
        } else {
            resultJSON['data']['bgp-peer']['value'] = [];
        }
        if (-1 != xmppArrIdx) {
            resultJSON['data']['xmpp-peer'] = data[xmppArrIdx];
        } else {
            resultJSON['data']['xmpp-peer']['value'] = [];
        }
        resultJSON['lastKey'] = retLastKey;
        if (null == retLastKey) {
            resultJSON['more'] = false;
        } else {
            resultJSON['more'] = true;
        }
        callback(err, resultJSON);
    });
}

function parseControlNodeHostsList (resultJSON, jsonData)
{
    try {
        var bgpRtr = jsonData['bgp-routers'];
        var nodeCount = bgpRtr.length;
        var j = 0;
        for (var i = 0; i < nodeCount; i++) {
            try {
                resultJSON[j] = bgpRtr[i]['fq_name'][4];
                j++;
            } catch(e) {
               logutils.logger.debug("BGP hostName not set for uuid: " + bgpRtr[i]['uuid']);
               continue;
            }
        }
    } catch(e) {
        return [];
    }
}

/* Function: getControlNodeHosts
    This API is used to get the Control Node Host Lists
 */
function getControlNodeHosts (req, res)
{
    var url = '/bgp-routers?parent_fq_name_str=default-domain:default-project:ip-fabric:__default__';
    configApiServer.apiGet(url, appData, function (error, jsonData) {
        if (error) {
            commonUtils.handleJSONResponse(error, res, null);
        } else {
            var resultJSON = [];
            parseControlNodeHostsList(resultJSON, jsonData);
            commonUtils.handleJSONResponse(null, res, resultJSON);
        }
    });
}

function getControlNodesTree (req, res, appData)
{
    var isHostName = req.param('hostlists');
    if (isHostName) {
        getControlNodeHosts(req, res);
        return;
    }
    var url = '/virtual-routers';
    /* Now send cache updation request for list of control node names */
    cacheApi.queueDataFromCacheOrSendRequest(req, res, global.STR_JOB_TYPE_CACHE,
                                             global.STR_GET_NODES_TREE, url, 0,
                                             /* Update every 5 minutes */
                                             0, 0, 1 * 60 * 1000, true);
    return;
}

function getBgpPeerList (req, res, appData)
{
    var hostname = req.param('hostname');
    var urlList = [];
    var dataObjArr = [];

    var reqUrl = '/analytics/uves/xmpp-peer/' + hostname +
        ':*?cfilt=XmppPeerInfoData:identifier';
    commonUtils.createReqObj(dataObjArr, reqUrl,
                             null, null, null, null, appData);
    reqUrl = '/analytics/uves/bgp-peer/*:' + hostname +
        ':*?cfilt=BgpPeerInfoData:peer_address';
    commonUtils.createReqObj(dataObjArr, reqUrl,
                             null, null, null, null, appData);

    async.map(dataObjArr,
              commonUtils.getAPIServerResponse(opApiServer.apiGet, true),
              function(err, data) {
        if (err || (null == data)) {
            commonUtils.handleJSONResponse(null, res, []);
            return;
        }
        var bgpPeer = jsonPath(data[0], "$..identifier");
        var xmppPeer = jsonPath(data[1], "$..peer_address");
        if ((!bgpPeer.length) && (!xmppPeer.length)) {
            peer = [];
        } else {
            if (!bgpPeer.length) {
                peer = xmppPeer;
            } else if (!xmppPeer.length) {
                peer = bgpPeer;
            } else {
                peer = bgpPeer.concat(xmppPeer);
            }
        }
        commonUtils.handleJSONResponse(err, res, peer);
    });
}

function getControlNodeRoutingInstanceList (req, res, appData)
{
    var queryData = urlMod.parse(req.url, true);
    var ip = queryData.query['ip'];
    var nextKey = queryData.query['lastKey'];
    var hostname = queryData.query['hostname'];

    var url = '/Snh_ShowRoutingInstanceSummaryReq?';
    var dataObjArr = [];

    if (null != nextKey) {
        url = '/Snh_ShowRoutingInstanceSummaryReqIterate?x=' + nextKey;
    }
    var bgpRtrRestAPI =
        commonUtils.getRestAPIServer(ip, global.SANDESH_CONTROL_NODE_PORT,
                                     global.SANDESH_API);
    commonUtils.createReqObj(dataObjArr, url);
    async.map(dataObjArr,
              commonUtils.getServerRespByRestApi(bgpRtrRestAPI, false),
            function(err, results) {
        if ((null == err) && (null != results) && (null != results[0])) {
            var data = results[0];
            var nextKey =
                commonUtils.getValueByJsonPath(data,
                                               'ShowRoutingInstanceSummaryResp;next_batch',
                                               null);
            data['lastKey'] = nextKey;
            if ((null == nextKey) || ("" == nextKey)) {
                data['more'] = false;
            } else {
                data['more'] = true;
            }
            delete data['next_batch'];
            commonUtils.handleJSONResponse(err, res, data);
        } else {
            commonUtils.handleJSONResponse(err, res, null);
        }
    });
}

function getControlNodeRoutes (req, res, appData)
{
    var queryData = urlMod.parse(req.url, true);
    var ip = queryData.query['ip'];
    var routingInst = queryData.query['routingInst'];
    var routingTable = queryData.query['routingTable'];
    var prefix = queryData.query['prefix'];
    var count = queryData.query['limit'];
    var peerSource = queryData.query['peerSource'];
    var addrFamily = queryData.query['addrFamily'];
    var protocol = queryData.query['protocol'];
    var startRoutingTable = commonUtils.getValueByJsonPath(queryData, 'query;startRoutingTable','');
    var startRoutingInstance = commonUtils.getValueByJsonPath(queryData, 'query;startRoutingInstance','');
    var startPrefix = commonUtils.getValueByJsonPath(queryData, 'query;startPrefix','');
    var dataObjArr = [];

    if (null == routingInst) {
        routingInst ='';
    }
    if (null == routingTable) {
        routingTable = '';
    }
    if (null == prefix) {
        prefix = '';
    }
    if (null == count) {
        count = '';
    }
    if (addrFamily) {
        addrFamily = '.' + addrFamily + '.';
    }

    url =  '/Snh_ShowRouteReq?routing_table=' + encodeURIComponent(routingTable) +
        '&routing_instance=' + encodeURIComponent(routingInst) +
        '&prefix=' + encodeURIComponent(prefix) + '&longer_match=&count=' +
        count + '&start_routing_table=' + startRoutingTable + 
        '&start_routing_instance=' + startRoutingInstance + '&start_prefix=' + startPrefix;

    var resultJSON = [];
    var bgpRtrRestAPI =
        commonUtils.getRestAPIServer(ip, global.SANDESH_CONTROL_NODE_PORT,
                                     global.SANDESH_API);
    commonUtils.createReqObj(dataObjArr, url);
    async.map(dataObjArr,
              commonUtils.getServerRespByRestApi(bgpRtrRestAPI, true),
              function(err, data) {
        if (data) {
            commonUtils.handleJSONResponse(null, res, data);
        } else {
            commonUtils.handleJSONResponse(null, res, []);
        }
    });
}

exports.getControlNodesSummary = getControlNodesSummary;
exports.getControlNodeDetails = getControlNodeDetails;
exports.getControlNodePeerInfo = getControlNodePeerInfo;
exports.getControlNodePeerDetails = getControlNodePeerDetails;
exports.getControlNodePeerPagedInfo = getControlNodePeerPagedInfo;
exports.getControlNodeSandeshRequest = getControlNodeSandeshRequest;
exports.getControlNodesTree = getControlNodesTree;
exports.getControlNodeRoutingInstanceList = getControlNodeRoutingInstanceList;
exports.getBgpPeerList = getBgpPeerList;
exports.getControlNodeRoutes = getControlNodeRoutes;


