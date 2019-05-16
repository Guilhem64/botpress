import classnames from 'classnames'
import { observe } from 'mobx'
import { inject, observer } from 'mobx-react'
import queryString from 'query-string'
import React from 'react'
import { IntlProvider } from 'react-intl'

import Container from './components/Container'
import constants from './core/constants'
import BpSocket from './core/socket'
import ChatIcon from './icons/Chat'
import { RootStore, StoreDef } from './store'
import { availableLocale, defaultLocale, getUserLocale, initializeLocale, translations } from './translations'
import { checkLocationOrigin, initializeAnalytics } from './utils'

const _values = obj => Object.keys(obj).map(x => obj[x])

class Web extends React.Component<MainProps> {
  private socket: BpSocket
  private parentClass: string

  state = {
    played: false
  }

  constructor(props) {
    super(props)

    initializeLocale()
    checkLocationOrigin()
    initializeAnalytics()
  }

  componentDidMount() {
    window.addEventListener('message', this.handleIframeApi)
    this.initialize()
  }

  componentWillUnmount() {
    window.removeEventListener('message', this.handleIframeApi)
  }

  async initialize() {
    this.socket = new BpSocket(this.props.bp)
    this.socket.onMessage = this.handleNewMessage
    this.socket.onTyping = this.props.updateTyping
    this.socket.onUserIdChanged = this.props.setUserId
    this.socket.setup()

    const config = this.extractConfig()
    config.overrides && this.loadOverrides(config.overrides)
    config.userId && this.socket.changeUserId(config.userId)

    await this.socket.waitForUserId()
    await this.props.initializeChat()

    this.setupObserver()

    this.props.setLoadingCompleted()
  }

  extractConfig() {
    const { options } = queryString.parse(location.search)
    const { config } = JSON.parse(decodeURIComponent(options || '{}'))

    const userConfig = Object.assign({}, constants.DEFAULT_CONFIG, config)
    this.props.updateConfig(userConfig, this.props.bp)

    return userConfig
  }

  loadOverrides(overrides) {
    for (const override of _values(overrides)) {
      this.props.bp.loadModuleView(override.module, true)
    }
  }

  // When the user ID is changed in the configuration, it will update the socket automatically
  setupObserver() {
    observe(this.props.config, 'userId', async data => {
      if (!data.oldValue) {
        return
      }

      await this.socket.changeUserId(data.newValue)
      await this.props.initializeChat()
    })

    observe(this.props.config, 'overrides', data => {
      if (data.newValue && window.parent) {
        this.loadOverrides(data.newValue)
      }
    })

    observe(this.props.dimensions, 'container', data => {
      if (data.newValue && window.parent) {
        window.parent.postMessage({ type: 'setWidth', value: data.newValue }, '*')
      }
    })
  }

  handleIframeApi = ({ data: { action, payload } }) => {
    if (action === 'configure') {
      this.props.updateConfig(Object.assign({}, constants.DEFAULT_CONFIG, payload))
    } else if (action === 'event') {
      const { type, text } = payload

      if (type === 'show') {
        this.props.showChat()
      } else if (type === 'hide') {
        this.props.hideChat()
      } else if (type === 'message') {
        this.props.sendMessage(text)
      } else {
        this.props.sendData({ type, payload })
      }
    }
  }

  handleNewMessage = async event => {
    if ((event.payload && event.payload.type === 'visit') || event.message_type === 'visit') {
      // don't do anything, it's the system message
      return
    }

    this.props.addEventToConversation(event)

    // there's no focus on the actual conversation
    if ((document.hasFocus && !document.hasFocus()) || this.props.activeView !== 'side') {
      this.playSound()
      this.props.incrementUnread()
    }

    this.handleResetUnreadCount()
  }

  playSound() {
    if (this.state.played) {
      return
    }

    const audio = new Audio('/assets/modules/channel-web/notification.mp3')
    audio.play()

    this.setState({ played: true })

    setTimeout(() => {
      this.setState({ played: false })
    }, constants.MIN_TIME_BETWEEN_SOUNDS)
  }

  handleResetUnreadCount = () => {
    if (document.hasFocus && document.hasFocus() && this.props.activeView === 'side') {
      this.props.resetUnread()
    }
  }

  renderWidget() {
    if (!this.props.showWidgetButton) {
      return null
    }

    return (
      <button
        className={classnames('bpw-widget-btn', 'bpw-floating-button', {
          ['bpw-anim-' + this.props.widgetTransition]: true
        })}
        onClick={this.props.showChat.bind(this)}
      >
        <ChatIcon />
        {this.props.hasUnreadMessages && <span className={'bpw-floating-button-unread'}>{this.props.unreadCount}</span>}
      </button>
    )
  }

  renderSide() {
    const locale = getUserLocale(availableLocale, defaultLocale)
    return (
      <IntlProvider locale={locale} messages={translations[locale]} defaultLocale={defaultLocale}>
        <Container />
      </IntlProvider>
    )
  }

  render() {
    if (!this.props.isReady) {
      return null
    }

    const parentClass = `bp-widget-web bp-widget-${this.props.activeView}`
    if (this.parentClass !== parentClass) {
      window.parent && window.parent.postMessage({ type: 'setClass', value: parentClass }, '*')
      this.parentClass = parentClass
    }

    const { stylesheet, extraStylesheet } = this.props.config

    return (
      <div onFocus={this.handleResetUnreadCount}>
        {stylesheet && stylesheet.length && <link rel="stylesheet" type="text/css" href={stylesheet} />}
        {extraStylesheet && extraStylesheet.length && <link rel="stylesheet" type="text/css" href={extraStylesheet} />}
        {this.props.displayWidgetView ? this.renderWidget() : this.renderSide()}
      </div>
    )
  }
}

export default inject(({ store }: { store: RootStore }) => ({
  store,
  config: store.config,
  sendData: store.sendData,
  initializeChat: store.initializeChat,
  updateConfig: store.updateConfig,
  addEventToConversation: store.addEventToConversation,
  setUserId: store.setUserId,
  updateTyping: store.updateTyping,
  sendMessage: store.sendMessage,

  isReady: store.view.isReady,
  showWidgetButton: store.view.showWidgetButton,
  hasUnreadMessages: store.view.hasUnreadMessages,
  unreadCount: store.view.unreadCount,
  resetUnread: store.view.resetUnread,
  incrementUnread: store.view.incrementUnread,
  activeView: store.view.activeView,
  showChat: store.view.showChat,
  hideChat: store.view.hideChat,
  dimensions: store.view.dimensions,
  widgetTransition: store.view.widgetTransition,
  displayWidgetView: store.view.displayWidgetView,
  setLoadingCompleted: store.view.setLoadingCompleted
}))(observer(Web))

type MainProps = Pick<
  StoreDef,
  | 'bp'
  | 'config'
  | 'initializeChat'
  | 'sendMessage'
  | 'setUserId'
  | 'sendData'
  | 'updateTyping'
  | 'hideChat'
  | 'showChat'
  | 'widgetTransition'
  | 'activeView'
  | 'unreadCount'
  | 'hasUnreadMessages'
  | 'showWidgetButton'
  | 'addEventToConversation'
  | 'updateConfig'
  | 'isReady'
  | 'incrementUnread'
  | 'displayWidgetView'
  | 'resetUnread'
  | 'setLoadingCompleted'
  | 'dimensions'
>