import React, { Component, PropTypes } from 'react';
import ReactDOM from 'react-dom';
import Extensions from '@jenkins-cd/js-extensions';
import LogConsole from './LogConsole';
import * as sse from '@jenkins-cd/sse-gateway';

import LogToolbar from './LogToolbar';
import Steps from './Steps';
import {
    steps as stepsSelector,
    logs as logSelector,
    node as nodeSelector,
    nodes as nodesSelector,
    actions,
    connect,
    createSelector,
} from '../redux';

import { calculateStepsBaseUrl, calculateRunLogURLObject, calculateNodeBaseUrl } from '../util/UrlUtils';
import { calculateNode } from '../util/KaraokeHelper';


const { string, object, any, func } = PropTypes;

export class RunDetailsPipeline extends Component {
    constructor(props) {
        super(props);
        // we do not want to follow any builds that are finished
        this.state = { followAlong: props && props.result && props.result.state !== 'FINISHED' };
    }

    componentWillMount() {
        const { fetchNodes, fetchLog, result, fetchSteps } = this.props;

        this.mergedConfig = this.generateConfig(this.props);

        const supportsNode = result && result._class === 'io.jenkins.blueocean.service.embedded.rest.PipelineRunImpl';
        if (supportsNode) {
            fetchNodes(this.mergedConfig);
        } else {
            // console.log('fetch the log directly')
            const logGeneral = calculateRunLogURLObject(this.mergedConfig);
            fetchLog({ ...logGeneral });
        }

        // Listen for pipeline flow node events.
        // We filter them only for steps and the end event all other we let pass
        const onSseEvent = (event) => {
            const jenkinsEvent = event.jenkins_event;
            console.log('eventComing');
            try {
                if (!this.state.followAlong || event.pipeline_run_id !== this.props.result.id) {
                    console.log('early out');
                    throw new Error('exit');
                }
            console.log('eventComing trhrough', event);
                // we turn on refetch so we always fetch a new Node result
                const refetch = true;
                switch (jenkinsEvent) {
                case 'pipeline_step':
                    {
                        console.log('???', this.mergedConfig.node, event);
                        // if the step_stage_id has changed we need to change the focus
                        if (event.pipeline_step_stage_id !== this.mergedConfig.node) {
                            delete this.mergedConfig.node;
                            console.log('only nodes', this.mergedConfig.node);
                            fetchNodes({ ...this.mergedConfig, refetch });
                        } else {
                            console.log('only steps');
                            fetchSteps({ ...this.mergedConfig, refetch });
                        }
                        break;
                    }
                case 'pipeline_end':
                    {
                        fetchNodes({ ...this.mergedConfig, refetch });
                        break;
                    }
                default:
                    {
                        // console.log(event);
                    }
                }
            } catch (e) {
                // we only ignore the exit error
                if (e.message !== 'exit') {
                    throw e;
                }
            }
        };

        console.log('?', this.state.followAlong);
        this.pipelineListener = sse.subscribe('pipeline', onSseEvent);
    }

    componentDidMount() {
        const onScrollHandler = (elem) => {
            if (elem.deltaY < 0 && this.state.followAlong) {
                console.log('this.setState({ followAlong: false });');
                this.setState({ followAlong: false });
            }
        };

        const _handleKeys = (event) => {
            if (event.keyCode === 38 && this.state.followAlong) {
                console.log('this.setState({ followAlong: false });');
                this.setState({ followAlong: false });
            }
        };
        const domNode = ReactDOM.findDOMNode(this.refs.scrollArea);
        domNode.addEventListener('wheel', onScrollHandler, false);
        document.addEventListener('keydown', _handleKeys, false);
    }

    // shouldComponentUpdate(nextProps, nextState) {
    // }

    componentWillReceiveProps(nextProps) {
        const followAlong = this.state.followAlong;
        this.mergedConfig = this.generateConfig({ ...nextProps, followAlong });

        console.log('       this.pipelineListener', this.mergedConfig, this.props);
        if (!this.state.followAlong && this.timeout) {
            console.log('clearTO');
            clearTimeout(this.timeout);
        }
        const nodeAction = calculateNode (this.props, nextProps, this.mergedConfig);
        if (nodeAction && nodeAction.action) {
            // use updated config
            this.mergedConfig = nodeAction.config;
            // we may need to stop following
            if (this.state.followAlong !== nodeAction.state.followAlong) {
                this.setState({ followAlong: nodeAction.state.followAlong });
            }
            this.props[nodeAction.action](this.mergedConfig);
        }
/*
        if (nextProps.params.node !== this.props.params.node) {
            this.mergedConfig.node = nextProps.params.node;
            // we turn on refetch so we always fetch a new Node result
            const refetch = true;
            delete this.mergedConfig.node;
            console.log('hasta', this.mergedConfig);
            this.props.fetchNodes({ ...this.mergedConfig, refetch });
            if (!this.state.followAlong) {
                this.setState({ followAlong: true });
            }
        }
*/
        const { logs, fetchLog } = nextProps;
        if (logs !== this.props.logs) {
            const logGeneral = calculateRunLogURLObject(this.mergedConfig);
            const log = logs ? logs[logGeneral.url] : null;
            if (log && log !== null) {
                const newStart = log.newStart;
                if (Number(newStart) > 0) {
                    // kill current  timeout if any
                    console.log('prefollow', this.state.followAlong);
                    clearTimeout(this.timeout);
                    if (this.state.followAlong) {
                        console.log('follow', this.state.followAlong);
                        this.timeout = setTimeout(() => fetchLog({ ...logGeneral, newStart }), 1000);
                    }
                }
            }
        }
    }

    componentWillUnmount() {
        console.log('unmounting');
        if (this.pipelineListener) {
            sse.unsubscribe(this.pipelineListener);
            delete this.pipelineListener;
        }
        this.props.cleanNodePointer();
        clearTimeout(this.timeout);
    }

    generateConfig(props) {
        const {
            config = {},
        } = this.context;
        const followAlong = this.state.followAlong;
        const {
            isMultiBranch,
            params: { pipeline: name, branch, runId, node: nodeParam },
        } = props;
        // we would use default properties however the node can be null so no default properties will be triggered
        let { nodeReducer } = props;
        if (!nodeReducer) {
            nodeReducer = { id: null, displayName: 'Steps' };
        }
        // if we have a node param we do not want the calculation of the focused node
        let node = nodeParam || nodeReducer.id;
        // however if we follow along we actually do want to change the focus
        // if (followAlong && nodeReducer.id > node) {
        //     node = nodeReducer.id;
        // }
        const mergedConfig = { ...config, name, branch, runId, isMultiBranch, node, nodeReducer, followAlong };
        return mergedConfig;
    }

    render() {
        const {
            location,
            router,
        } = this.context;

        const {
            params: {
                pipeline: name, branch, runId,
            },
            isMultiBranch, steps, nodes, logs, result: resultMeta,
        } = this.props;

        const {
            result,
            state,
        } = resultMeta;
        const resultRun = result === 'UNKNOWN' || !result ? state : result;
        const followAlong = this.state.followAlong;
        const scrollToBottom =
            resultRun.toLowerCase() === 'failure'
            || (resultRun.toLowerCase() === 'running' && followAlong)
        ;


        const nodeKey = calculateNodeBaseUrl(this.mergedConfig);
        const key = calculateStepsBaseUrl(this.mergedConfig);
        const logGeneral = calculateRunLogURLObject(this.mergedConfig);
        const log = logs ? logs[logGeneral.url] : null;
        console.log('merged', this.mergedConfig.node, key);
        let title = this.mergedConfig.nodeReducer.displayName;
        if (log) {
            title = 'Logs';
        } else if (this.mergedConfig.nodeReducer.id !== null) {
            title = `Steps - ${title}`;
        }
        const stopFollowing = (event) => {
            console.log(this.refs, event, !followAlong);
            this.setState({ followAlong: !followAlong });
        };
        // console.log('steps to render', key, steps, nodeKey)
        // if(steps && steps[key]){
        //     console.log('steps to render found', steps[key])
        // }
        return (
            <div ref="scrollArea">
                { nodes && nodes[nodeKey] && <Extensions.Renderer
                  extensionPoint="jenkins.pipeline.run.result"
                  router={router}
                  location={location}
                  nodes={nodes[nodeKey].model}
                  pipelineName={name}
                  branchName={isMultiBranch ? branch : undefined}
                  runId={runId}
                />
                }
                <button onClick={stopFollowing}>noFollow</button>
                <LogToolbar
                  fileName={logGeneral.fileName}
                  url={logGeneral.url}
                  title={title}
                />
                { steps && steps[key] && <Steps
                  nodeInformation={steps[key]}
                  followAlong={followAlong}
                  {...this.props}
                />
                }

                { log && <LogConsole key={logGeneral.url} logArray={log.logArray} scrollToBottom={scrollToBottom} /> }
            </div>
        );
    }
}

RunDetailsPipeline.propTypes = {
    pipeline: object,
    isMultiBranch: any,
    params: object,
    result: object,
    fileName: string,
    url: string,
    fetchLog: func,
    fetchNodes: func,
    setNode: func,
    fetchSteps: func,
    cleanNodePointer: func,
    logs: object,
    steps: object,
    nodes: object,
    nodeReducer: object,
};

RunDetailsPipeline.contextTypes = {
    config: object.isRequired,
    params: object,
    pipeline: object,
    router: object.isRequired, // From react-router
    location: object.isRequired, // From react-router
};

const selectors = createSelector(
    [stepsSelector, logSelector, nodeSelector, nodesSelector],
    (steps, logs, nodeReducer, nodes) => ({ steps, logs, nodeReducer, nodes }));

export default connect(selectors, actions)(RunDetailsPipeline);
