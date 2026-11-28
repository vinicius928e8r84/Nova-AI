'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..');
const RAIZ = path.join(PASTA, '..', '..');

const GANCHOS = [
  ['movieSink', 'renderSampleBuffer:forInput:', 'bridgeMovieSinkRender', 'g_originalMovieSinkRender'],
  ['queueSink', 'renderSampleBuffer:forInput:', 'bridgeQueueSinkRender', 'g_originalQueueSinkRender'],
  ['device', 'prepareToCaptureStillImageNow:', 'bridgeDevicePrepare', 'g_originalDevicePrepare'],
  ['stream', 'prepareForStillImageCaptureFromFirmwareWithStillImageSettings:', 'bridgeStreamPrepareStill', 'g_originalStreamPrepareStill'],
  ['timeMachine', 'renderSampleBuffer:forInput:', 'bridgeTimeMachineRender', 'g_originalTimeMachineRender'],
  ['timeMachine', '_handleSampleBuffer:', 'bridgeTimeMachineHandle', 'g_originalTimeMachineHandle'],
  ['timeMachine', '_isCaptureComplete', 'bridgeTimeMachineComplete', 'g_originalTimeMachineComplete'],
  ['output', 'emitSampleBuffer:', 'bridgeOutputEmit', 'g_originalOutputEmit'],
  ['coordinator', 'renderSampleBuffer:forInput:', 'bridgeCoordinatorRender', 'g_originalCoordinatorRender'],
  ['gnr', 'renderSampleBuffer:forInput:', 'bridgeGNRRender', 'g_originalGNRRender'],
  ['compressor', 'renderSampleBuffer:forInput:', 'bridgeCompressorRender', 'g_originalCompressorRender'],
  ['pressure', 'setInitialSemaphoreValue:', 'bridgeInitialSemaphore', 'g_originalInitialSemaphore'],
  ['graph', 'connectOutput:toInput:pipelineStage:', 'redirectedConnect', 'g_originalConnect'],
  ['g_physicalClass', 'start:', 'suppressedPhysicalStart', 'g_originalPhysicalStart'],
  ['g_physicalClass', 'stop:', 'suppressedPhysicalStop', 'g_originalPhysicalStop'],
  ['g_physicalClass', 'allocateOrReuseBufferPoolsFromSourceNode:', 'suppressedPhysicalPools', 'g_originalPhysicalPools'],
  ['g_physicalClass', 'clock', 'physicalClockOverride', 'g_originalPhysicalClock'],
  ['graph', 'start:', 'bridgeGraphStart', 'g_originalGraphStart'],
  ['graph', 'stop:', 'bridgeGraphStop', 'g_originalGraphStop'],
  ['graph', 'commitConfigurationWithID:error:', 'bridgeGraphCommit', 'g_originalGraphCommit'],
  ['graph', 'startDeferredSourceNodesIfNeeded', 'bridgeDeferredStartHook', 'g_originalDeferredStart'],
  ['graph', 'startDeferredNodePrepareIfNeededWithCompletionHandler:', 'bridgeDeferredPrepareHook', 'g_originalDeferredPrepare'],
];

const CHAVES_DO_CONTROLE = [
  'appID', 'appIDs', 'audioInjection', 'continuous', 'directRecording', 'expiresAt', 'frameRate',
  'mode', 'photoPrepareBypass', 'previewOnly', 'remoteQueuePortType', 'socket', 'url', 'videoInjection',
];

const CHAVES_DO_ESTADO = [
  'version', 'pid', 'observedAppIDs', 'allowedAppIDs', 'audioInjection', 'audioQueued', 'audioSequence',
  'audioReplaced', 'audioDropped', 'audioFetchFailures', 'directRecording', 'recordConnections',
  'videoInjection', 'compressorImageSamples', 'compressorControlSamples', 'photoPrepareBypass',
  'photoPrepareBypasses', 'photoPrepareHookReady', 'photoStillHookReady', 'photoStillRequests',
  'photoPortRemapHookReady', 'photoPortRemaps', 'lastPhotoStreamSettings', 'lastTimeMachineFrame',
  'photoTimeMachineHandleHookReady', 'photoTimeMachineHandles', 'photoTimeMachineOutputEmits',
  'photoTimeMachineCompleteChecks', 'photoTimeMachineCompleteTrue', 'photoTimeMachineConnectionsResumed',
  'photoCoordinatorRenderHookReady', 'photoCoordinatorRenders', 'photoSyntheticWillCaptures',
  'photoSyntheticCompletions', 'photoCoordinatorOutputEmits', 'lastCoordinatorState', 'photoRoute',
  'photoGNRHookReady', 'photoGNRBypasses', 'lastGNRFrame', 'emittedRecord', 'minimumBufferBudgets',
  'continuous', 'targetFPS', 'previewOnly', 'timestamp', 'hooksReady', 'enabled', 'faulted', 'expiresAt',
  'sessions', 'redirected', 'suppressedStarts', 'emittedVideo', 'emittedStill', 'fetchFailures',
  'graphStarts', 'graphStartFailures', 'graphStops', 'contextLimitHits', 'contextCount', 'graphClasses',
  'startHookDispatchMisses', 'graphCommits', 'graphCommitFailures', 'connectionsResumed',
  'remoteQueueRenders', 'remoteQueuePortRemaps', 'remoteQueueRenderFailures', 'remoteQueuePortType',
  'graphStopsSkipped', 'lastCommitError',
];

function fontesDaPonte() {
  return fs.readdirSync(PASTA)
    .filter((nome) => /\.(x|m)$/.test(nome))
    .sort()
    .map((nome) => fs.readFileSync(path.join(PASTA, nome), 'utf8'))
    .join('\n');
}

test('texto compilado da ponte: os 22 ganchos instalados, na ordem, com o original de cada um', () => {
  const instalados = [...fontesDaPonte().matchAll(/MSHookMessageEx\((\w+),\s*sel_registerName\("([^"]+)"\),\s*\(IMP\)(\w+),\s*\(IMP \*\)&(\w+)\)/g)]
    .map((achado) => achado.slice(1, 5));
  assert.deepEqual(instalados, GANCHOS);
});

test('texto compilado da ponte: as 14 chaves que o controle aceita', () => {
  const chaves = [...new Set([...fontesDaPonte().matchAll(/config\[@"(\w+)"\]/g)].map((achado) => achado[1]))].sort();
  assert.deepEqual(chaves, CHAVES_DO_CONTROLE);
});

test('texto compilado da ponte: as chaves do estado que o app lê', () => {
  const fonte = fontesDaPonte();
  const inicio = fonte.indexOf('NSDictionary *status = @{');
  assert.notEqual(inicio, -1);
  const fim = fonte.indexOf('};', inicio);
  const chaves = [...fonte.slice(inicio, fim).matchAll(/@"(\w+)":/g)].map((achado) => achado[1]);
  assert.deepEqual(chaves.sort(), [...CHAVES_DO_ESTADO].sort());
});

test('texto compilado da ponte: a versão é a mesma no controle do pacote, no estado e na instalação do iPhone', () => {
  const doControle = fs.readFileSync(path.join(PASTA, 'control'), 'utf8').match(/^Version: (\S+)$/m)[1];
  const doEstado = fontesDaPonte().match(/@"version":@"([^"]+)"/)[1];
  const instalacao = fs.readFileSync(path.join(RAIZ, 'app', 'electron', 'services', 'iphone-setup', 'setup-pacotes.js'), 'utf8');
  const daInstalacao = instalacao.match(/VERSAO_DA_PONTE_DA_CAMERA = '([^']+)'/)[1];
  assert.equal(doEstado, doControle);
  assert.equal(daInstalacao, doControle);
});
