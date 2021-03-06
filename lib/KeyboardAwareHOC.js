/* @flow */

import React from 'react'
import PropTypes from 'prop-types'
import ReactNative, {
  Keyboard,
  Platform,
  UIManager,
  TextInput,
  findNodeHandle,
  Animated,
  Dimensions
} from 'react-native'
import { isIphoneX } from 'react-native-iphone-x-helper'
import type { KeyboardAwareInterface } from './KeyboardAwareInterface'
import { NativeModules } from 'react-native';

const { RNTKeyboardAwareScrollView } = NativeModules;

const _KAM_DEFAULT_TAB_BAR_HEIGHT: number = isIphoneX() ? 83 : 49
const _KAM_KEYBOARD_OPENING_TIME: number = 250
const _KAM_EXTRA_LAYOUT_DELAY: number = 200
const _KEYBOARD_OPEN_CLOSE_USER_NOTICE_THRESHOLD = 500;
const _KAM_EXTRA_HEIGHT: number = 75

const supportedKeyboardEvents = [
  'keyboardWillShow',
  'keyboardDidShow',
  'keyboardWillHide',
  'keyboardDidHide',
  'keyboardWillChangeFrame',
  'keyboardDidChangeFrame'
]
const keyboardEventToCallbackName = (eventName: string) =>
  'on' + eventName[0].toUpperCase() + eventName.substring(1)
const keyboardEventPropTypes = supportedKeyboardEvents.reduce(
  (acc: Object, eventName: string) => ({
    ...acc,
    [keyboardEventToCallbackName(eventName)]: PropTypes.func
  }),
  {}
)
const keyboardAwareHOCTypeEvents = supportedKeyboardEvents.reduce(
  (acc: Object, eventName: string) => ({
    ...acc,
    [keyboardEventToCallbackName(eventName)]: Function
  }),
  {}
)

export type KeyboardAwareHOCProps = {
  viewIsInsideTabBar?: boolean,
  resetScrollToCoords?: {
    x: number,
    y: number
  },
  enableResetScrollToCoords?: boolean,
  enableAutomaticScroll?: boolean,
  extraHeight?: number,
  extraScrollHeight?: number,
  extraBottomInset?: number,
  inputAccessoryViewHeight: number,
  keyboardOpeningTime?: number,
  onScroll?: Function,
  onLayout?: Function,
  update?: Function,
  contentContainerStyle?: any,
  enableOnAndroid?: boolean,
  innerRef?: Function,
  ...keyboardAwareHOCTypeEvents
}
export type KeyboardAwareHOCState = {
  keyboardSpace: number,
  keyboardEndCoordinatesScreenY: number,
}

export type ElementLayout = {
  x: number,
  y: number,
  width: number,
  height: number
}

export type ContentOffset = {
  x: number,
  y: number
}

export type ScrollPosition = {
  x: number,
  y: number,
  animated: boolean
}

export type ScrollIntoViewOptions = ?{
  getScrollPosition?: (
    parentLayout: ElementLayout,
    childLayout: ElementLayout,
    contentOffset: ContentOffset
  ) => ScrollPosition
}

export type KeyboardAwareHOCOptions = ?{
  enableOnAndroid: boolean,
  contentContainerStyle: ?Object,
  enableAutomaticScroll: boolean,
  extraHeight: number,
  extraScrollHeight: number,
  extraBottomInset: number,
  inputAccessoryViewHeight: number,
  enableResetScrollToCoords: boolean,
  keyboardOpeningTime: number,
  viewIsInsideTabBar: boolean,
  refPropName: string,
  extractNativeRef: Function
}

function getDisplayName(WrappedComponent: React$Component) {
  return WrappedComponent && (WrappedComponent.displayName || WrappedComponent.name) || 'Component'
}

const ScrollIntoViewDefaultOptions: KeyboardAwareHOCOptions = {
  enableOnAndroid: false,
  contentContainerStyle: undefined,
  enableAutomaticScroll: true,
  extraHeight: _KAM_EXTRA_HEIGHT,
  extraScrollHeight: 0,
  extraBottomInset: 0,
  inputAccessoryViewHeight: 0,
  enableResetScrollToCoords: true,
  keyboardOpeningTime: _KAM_KEYBOARD_OPENING_TIME,
  viewIsInsideTabBar: false,

  // The ref prop name that will be passed to the wrapped component to obtain a ref
  // If your ScrollView is already wrapped, maybe the wrapper permit to get a ref
  // For example, with glamorous-native ScrollView, you should use "innerRef"
  refPropName: 'ref',
  // Sometimes the ref you get is a ref to a wrapped view (ex: Animated.ScrollView)
  // We need access to the imperative API of a real native ScrollView so we need extraction logic
  extractNativeRef: (ref: Object) => {
    // getNode() permit to support Animated.ScrollView automatically
    // see https://github.com/facebook/react-native/issues/19650
    // see https://stackoverflow.com/questions/42051368/scrollto-is-undefined-on-animated-scrollview/48786374
    if (ref.getNode) {
      return ref.getNode()
    } else {
      return ref
    }
  }
}

function KeyboardAwareHOC(
  ScrollableComponent: React$Component,
  userOptions: KeyboardAwareHOCOptions
) {
  const hocOptions: KeyboardAwareHOCOptions = {
    ...ScrollIntoViewDefaultOptions,
    ...userOptions
  }

  return class
    extends React.Component<KeyboardAwareHOCProps, KeyboardAwareHOCState>
    implements KeyboardAwareInterface {
    _rnkasv_keyboardView: any
    keyboardWillShowEvent: ?Function
    keyboardWillHideEvent: ?Function
    position: ContentOffset
    defaultResetScrollToCoords: ?{ x: number, y: number }
    mountedComponent: boolean
    handleOnScroll: Function
    handleOnLayout: Function
    refreshScrollForField: Function
    state: KeyboardAwareHOCState
    parentLayout: any
    bottomDistanceToWindow: number
    topDistanceToWindow: number
    keyboardWillHideTime: number

    static displayName = `KeyboardAware${getDisplayName(ScrollableComponent)}`

    static propTypes = {
      viewIsInsideTabBar: PropTypes.bool,
      resetScrollToCoords: PropTypes.shape({
        x: PropTypes.number.isRequired,
        y: PropTypes.number.isRequired
      }),
      enableResetScrollToCoords: PropTypes.bool,
      enableAutomaticScroll: PropTypes.bool,
      extraHeight: PropTypes.number,
      extraScrollHeight: PropTypes.number,
      keyboardOpeningTime: PropTypes.number,
      onScroll: PropTypes.oneOfType([
        PropTypes.func, // Normal listener
        PropTypes.object // Animated.event listener
      ]),
      onLayout: PropTypes.oneOfType([
        PropTypes.func, // Normal listener
        PropTypes.object // Animated.event listener
      ]),
      update: PropTypes.func,
      contentContainerStyle: PropTypes.any,
      enableOnAndroid: PropTypes.bool,
      innerRef: PropTypes.func,
      ...keyboardEventPropTypes
    }

    // HOC options are used to init default props, so that these options can be overriden with component props
    static defaultProps = {
      enableAutomaticScroll: hocOptions.enableAutomaticScroll,
      extraHeight: hocOptions.extraHeight,
      extraScrollHeight: hocOptions.extraScrollHeight,
      extraBottomInset: hocOptions.extraBottomInset,
      inputAccessoryViewHeight: hocOptions.inputAccessoryViewHeight,
      enableResetScrollToCoords: hocOptions.enableResetScrollToCoords,
      keyboardOpeningTime: hocOptions.keyboardOpeningTime,
      viewIsInsideTabBar: hocOptions.viewIsInsideTabBar,
      enableOnAndroid: hocOptions.enableOnAndroid
    }

    constructor(props: KeyboardAwareHOCProps) {
      super(props)
      this.keyboardWillShowEvent = undefined
      this.keyboardWillHideEvent = undefined
      this.callbacks = {}
      this.position = { x: 0, y: 0 }
      this.defaultResetScrollToCoords = null
      const keyboardSpace: number = props.viewIsInsideTabBar
        ? _KAM_DEFAULT_TAB_BAR_HEIGHT
        : 0
      this.state = { keyboardSpace }
      this.refreshScrollForField = this._refreshScrollForField.bind( this );
    }

    async componentDidMount() {
      this.mountedComponent = true
      // Keyboard events
      if (Platform.OS === 'ios') {
        this.keyboardWillShowEvent = Keyboard.addListener(
          'keyboardWillShow',
          this._updateKeyboardSpace
        )
        this.keyboardWillHideEvent = Keyboard.addListener(
          'keyboardWillHide',
          this._resetKeyboardSpace
        )
      } else if (Platform.OS === 'android' && this.props.enableOnAndroid) {
        this.keyboardWillShowEvent = Keyboard.addListener(
          'keyboardDidShow',
          this._updateKeyboardSpace
        )
        this.keyboardWillHideEvent = Keyboard.addListener(
          'keyboardDidHide',
          this._resetKeyboardSpace
        )
      }
      supportedKeyboardEvents.forEach((eventName: string) => {
        const callbackName = keyboardEventToCallbackName(eventName)
        if (this.props[callbackName]) {
          this.callbacks[eventName] = Keyboard.addListener(
            eventName,
            this.props[callbackName]
          )
        }
      })
    }

    componentWillReceiveProps(nextProps: KeyboardAwareHOCProps) {
      if (nextProps.viewIsInsideTabBar !== this.props.viewIsInsideTabBar) {
        const keyboardSpace: number = nextProps.viewIsInsideTabBar
          ? _KAM_DEFAULT_TAB_BAR_HEIGHT
          : 0
        if (this.state.keyboardSpace !== keyboardSpace) {
          this.setState({ keyboardSpace })
        }
      }
    }

    componentWillUnmount() {
      this.mountedComponent = false
      this.keyboardWillShowEvent && this.keyboardWillShowEvent.remove()
      this.keyboardWillHideEvent && this.keyboardWillHideEvent.remove()
      Object.values(this.callbacks).forEach((callback: Object) =>
        callback.remove()
      )
    }

    getScrollResponder = () => {
      return (
        this._rnkasv_keyboardView &&
        this._rnkasv_keyboardView.getScrollResponder()
      )
    }

    scrollToPosition = (x: number, y: number, animated: boolean = true) => {
      const responder = this.getScrollResponder()
      responder && responder.scrollResponderScrollTo({ x, y, animated })
    }

    scrollToEnd = (animated?: boolean = true) => {
      const responder = this.getScrollResponder()
      responder && responder.scrollResponderScrollToEnd({ animated })
    }

    scrollForExtraHeightOnAndroid = (extraHeight: number) => {
      this.scrollToPosition(0, this.position.y + extraHeight, true)
    }

    /**
     * @param keyboardOpeningTime: takes a different keyboardOpeningTime in consideration.
     * @param extraHeight: takes an extra height in consideration.
     */
    scrollToFocusedInput = (
      reactNode: any,
      extraHeight?: number,
      keyboardOpeningTime?: number
    ) => {
      if (extraHeight === undefined) {
        extraHeight = this.props.extraHeight || 0
      }
      if (keyboardOpeningTime === undefined) {
        keyboardOpeningTime = this.props.keyboardOpeningTime || 0
      }
      setTimeout(() => {
        if (!this.mountedComponent) {
          return
        }
        const responder = this.getScrollResponder()
        reactNode = reactNode + 20
        responder &&
          responder.scrollResponderScrollNativeHandleToKeyboard(
            reactNode,
            extraHeight,
            true
          )
      }, keyboardOpeningTime)
    }

    scrollIntoView = async (
      element: React.Element<*>,
      options: ScrollIntoViewOptions = {}
    ) => {
      if (!this._rnkasv_keyboardView || !element) {
        return
      }

      const [parentLayout, childLayout] = await Promise.all([
        this._measureElement(this._rnkasv_keyboardView),
        this._measureElement(element)
      ])

      const getScrollPosition =
        options.getScrollPosition || this._defaultGetScrollPosition
      const { x, y, animated } = getScrollPosition(
        parentLayout,
        childLayout,
        this.position
      )
      this.scrollToPosition(x, y, animated)
    }

    _defaultGetScrollPosition = (
      parentLayout: ElementLayout,
      childLayout: ElementLayout,
      contentOffset: ContentOffset
    ): ScrollPosition => {
      return {
        x: 0,
        y: Math.max(0, childLayout.y - parentLayout.y + contentOffset.y),
        animated: true
      }
    }

    _measureElement = (element: React.Element<*>): Promise<ElementLayout> => {
      const node = findNodeHandle(element)
      return new Promise((resolve: ElementLayout => void) => {
        UIManager.measureInWindow(
          node,
          (x: number, y: number, width: number, height: number) => {
            resolve({ x, y, width, height })
          }
        )
      })
    }

    async _calculateTopBottomDistanceIfNeeded() {
      if ( !this.parentLayout ) {
        const parentLayout = await this._measureElement(this._rnkasv_keyboardView);
        this.parentLayout = parentLayout;
        const { height: fullHeight } = Dimensions.get( 'window' );
        this.bottomDistanceToWindow = fullHeight - ( parentLayout.y + parentLayout.height );
        this.topDistanceToWindow = parentLayout.y;
      }
    }

    _wasKeyboardAlreadyOpen(keyboardWillOpenTime: number) {
      //happens when keyboard opens/closes very fast that user won't even notice
      return  ( keyboardWillOpenTime - this.keyboardWillHideTime ) < _KEYBOARD_OPEN_CLOSE_USER_NOTICE_THRESHOLD;
    }

    _calculateLayoutDelayOnKeyboardWillOpen(keyboardWillOpenTime: number) {
      var layoutDelay = 0;
      if ( this._wasKeyboardAlreadyOpen( keyboardWillOpenTime ) ) {
        layoutDelay = _KAM_EXTRA_LAYOUT_DELAY;
        this.keyboardWillHideTime = 0; //Reset until next keyboard hide
      }
      return layoutDelay;
    }

    // Keyboard actions
   _updateKeyboardSpace = async (keyboardEvent: Object) => {
      const layoutDelay = this._calculateLayoutDelayOnKeyboardWillOpen( Date.now() );
      // Automatically scroll to focused TextInput
      if (this.props.enableAutomaticScroll) {
        let keyboardSpace: number =
        keyboardEvent.endCoordinates.height + this.props.extraBottomInset
        if (this.props.viewIsInsideTabBar) {
          keyboardSpace -= _KAM_DEFAULT_TAB_BAR_HEIGHT
        }
        this.setState({ keyboardSpace, keyboardEndCoordinatesScreenY: keyboardEvent.endCoordinates.screenY})
        setTimeout(() => {
          this._refreshScrollForField(null);
        }, layoutDelay); //give some time to layout
      }
      if (!this.props.resetScrollToCoords) {
        if (!this.defaultResetScrollToCoords) {
          this.defaultResetScrollToCoords = this.position
        }
      }
    }

    _scrollingDelayFor( fieldId: ?number ) {
      if ( fieldId === undefined ) { //triggered by keyboard
        return this.props.keyboardOpeningTime || 0
      }
      return 0; //triggered programmatically
    }

    _viewIsDescendantOf(
      currentlyFocusedField: number,
      ancestorViewId: number,
      callback: (isAncestor: boolean) => void
      ) {
      if ( Platform.OS === 'ios' ) {
        RNTKeyboardAwareScrollView.viewIsDescendantOf(
          currentlyFocusedField,
          ancestorViewId,
          ( error: ?string, isAncestor: boolean ) => {
            if ( error ) {
              console.warn(`RNTKeyboardAwareScrollView.viewIsDescendantOf call returned error: ${ error }`);
              return;
            }
            callback(isAncestor);
          }
        );
      } else {
        UIManager.viewIsDescendantOf(
          currentlyFocusedField,
          ancestorViewId,
          callback
        )
      }
    }

    async _refreshScrollForField( fieldId: ?number ) {
      await this._calculateTopBottomDistanceIfNeeded();

      if ( !this.state ) {
        return;
      }
      const { keyboardSpace, keyboardEndCoordinatesScreenY } = this.state;
      const currentlyFocusedField = TextInput.State.currentlyFocusedField()
      const responder = this.getScrollResponder()
      if (!currentlyFocusedField || !responder ) {
        return
      }
      const scrollingDelay = this._scrollingDelayFor( fieldId );

      //it is ok to not have a fieldId but if we do then it should be same with currentlyFocusedField
      if ( !( fieldId && ( currentlyFocusedField == fieldId ) || !fieldId ) ) {
        return
      }
      this._viewIsDescendantOf(
        currentlyFocusedField,
        responder.getInnerViewNode(),
        (isAncestor: boolean) => {
          if (isAncestor) {
            if (Platform.OS === 'android') {
              this._scrollToBottomOfComponent(currentlyFocusedField, keyboardEndCoordinatesScreenY, keyboardSpace);
            } else {
              RNTKeyboardAwareScrollView.measureSelectionInWindow(
                currentlyFocusedField,
                (error: ?string, fieldX: number, fieldY: number, fieldWidth: number, fieldHeight: number,
                  caretX: number, caretY: number, caretRelativeX: number, caretRelativeY: number,
                  caretWidth: number, caretHeight: number, textInputBottomTextInset: number ) => {
                  const viewableBottomCoordinateY = this._viewableBottomCoordinateY( keyboardEndCoordinatesScreenY );
                  if ( error ) {
                    //Try old way
                    this._scrollToBottomOfComponent(currentlyFocusedField, viewableBottomCoordinateY, keyboardSpace);
                  } else {
                    // adjust scroll offset only if caret will remain out of viewable area
                    if ( this._isCaretOutOfViewableArea(caretY, caretHeight, viewableBottomCoordinateY) ) {
                      //Decide if we should scroll to the caret or to the bottom of the component
                      if( this._shouldScrollToBottomOfComponent(fieldY, fieldHeight, caretY, caretHeight, textInputBottomTextInset, viewableBottomCoordinateY) )
                      {
                        //Scroll till the bottom of component
                        this._doScrollToBottomOfComponent(currentlyFocusedField, fieldY, fieldHeight, viewableBottomCoordinateY, keyboardSpace, scrollingDelay);
                      } else {
                        //Scroll till the caret is visible
                        this._scrollToCaret(currentlyFocusedField, caretRelativeY, caretHeight, viewableBottomCoordinateY, scrollingDelay);
                      }
                    }
                  }
              });
            }
          }
        }
      )
    }

    _viewableBottomCoordinateY( keyboardEndCoordinatesScreenY: ?number ) {
      // When the soft keyboard is not present (using an external keyboard), `keyboardEndCoordinatesScreenY` is undefined.
      // We will use the top most Y point from the input accessory view as the keyboard screen Y value.
      const { height: windowHeight } = Dimensions.get( 'window' );
      return keyboardEndCoordinatesScreenY ? keyboardEndCoordinatesScreenY : windowHeight - this.props.inputAccessoryViewHeight;
    }

    _totalVerticalDistanceToWindow() {
      return this.topDistanceToWindow + this.bottomDistanceToWindow + this.props.extraBottomInset;
    }

    _scrollToCaret(
      currentlyFocusedField: number,
      caretRelativeY: number,
      caretHeight: number,
      keyboardEndCoordinatesScreenY: number,
      keyboardOpeningTime?: number)
      {
      if ( keyboardOpeningTime === undefined ) {
        keyboardOpeningTime = this.props.keyboardOpeningTime || 0
      }

      const measureLayoutSuccessHandler = (
        x: number,
        y: number,
        width: number,
        height: number) => {

        const extraScrollHeigth = caretHeight; //Show one extra line below the caret.
        const keyboardYOnWindow = keyboardEndCoordinatesScreenY;
        const textViewYOnScrollview = y;
        const totalAccessoriesHeight = this.props.inputAccessoryViewHeight + this.topDistanceToWindow;
        const caretBottomYOnScrollview = textViewYOnScrollview + caretRelativeY + caretHeight;
        let scrollOffsetY = caretBottomYOnScrollview + totalAccessoriesHeight + extraScrollHeigth - keyboardYOnWindow;

        scrollOffsetY = Math.max(0, scrollOffsetY); //prevent negative scroll offset
        const responder = this.getScrollResponder();
        responder && responder.scrollResponderScrollTo( { x: 0, y: scrollOffsetY, animated: true } );
      }

      const measureLayoutErrorHandler = ( e: Object ) => {
        console.error('Error measuring text field: ', e);
      }

      setTimeout( () => {
          if ( !this.mountedComponent ) {
            return
          }
          const responder = this.getScrollResponder();
          responder &&
          UIManager.measureLayout(
            ReactNative.findNodeHandle(currentlyFocusedField),
            ReactNative.findNodeHandle(responder.getInnerViewNode()),
            measureLayoutErrorHandler,
            measureLayoutSuccessHandler,
          );
      }, keyboardOpeningTime);
    }

    _isCaretAtLastLine(caretY: number, caretHeight: number, fieldY: number, fieldHeight: number, textInputBottomTextInset: number) {
      return ( caretY + 2*caretHeight + textInputBottomTextInset ) > ( fieldY + fieldHeight )
    }

    _isFocusedAreaFitsInViewableArea(caretY: number, fieldY: number, fieldHeight: number, keyboardEndCoordinatesScreenY: number) {
      const distanceBetweenCaretAndBottomOfField =  fieldY + fieldHeight - caretY + this.props.extraScrollHeight;
      const viewableAreaStartY = this.topDistanceToWindow;
      const viewableAreaEndY = keyboardEndCoordinatesScreenY - this.props.inputAccessoryViewHeight;
      const viewableAreaHeight = viewableAreaEndY - viewableAreaStartY;
      return viewableAreaHeight > distanceBetweenCaretAndBottomOfField;
    }

    _isCaretUnderKeyboard(caretY: number, caretHeight: number, keyboardEndCoordinatesScreenY) {
      const caretBottomPosition = caretY + caretHeight;
      const keyboardPosition = keyboardEndCoordinatesScreenY
      return caretBottomPosition > (keyboardPosition - this.props.inputAccessoryViewHeight);
    }

    _isCaretAboveViewableArea(caretY: number) { //caret may remain above the viewable area when orientation changes
      return this.topDistanceToWindow > caretY;
    }

    _isCaretOutOfViewableArea(caretY: number, caretHeight: number, keyboardEndCoordinatesScreenY: number) {
      return this._isCaretUnderKeyboard(caretY, caretHeight, keyboardEndCoordinatesScreenY ) ||
            this._isCaretAboveViewableArea(caretY);
    }

    _shouldScrollToBottomOfComponent(fieldY: number, fieldHeight: number, caretY: number, caretHeight: number, textInputBottomTextInset: number, keyboardEndCoordinatesScreenY: number)
    {
      //is there enough place in the viewable area when keyboard is open?
      return this._isFocusedAreaFitsInViewableArea( caretY, fieldY, fieldHeight, keyboardEndCoordinatesScreenY) &&
            //is the caret at the last line of the component?
            this._isCaretAtLastLine(caretY, caretHeight, fieldY, fieldHeight, textInputBottomTextInset);
    }

    _scrollToBottomOfComponent(currentlyFocusedField: number, keyboardEndCoordinatesScreenY: number, keyboardSpace: number) {
      UIManager.measureInWindow(
        currentlyFocusedField,
        (x: number, y: number, width: number, height: number) => {
          this._doScrollToBottomOfComponent(currentlyFocusedField, y, height, keyboardEndCoordinatesScreenY, keyboardSpace);
        }
      );
    }

    _extraScrollHeight() {
      const verticalDistanceToWindow = (this.state.keyboardEndCoordinatesScreenY !== undefined) ? this.topDistanceToWindow : this._totalVerticalDistanceToWindow();
      return this.props.extraScrollHeight + verticalDistanceToWindow + this.props.inputAccessoryViewHeight;
    }

    _doScrollToBottomOfComponent(currentlyFocusedField: number, y: number, height: number, keyboardEndCoordinatesScreenY: number, keyboardSpace: number, keyboardOpeningTime?: number) {
      // Check if the TextInput will be hidden by the keyboard
      const textInputBottomPosition = y + height
      const keyboardPosition = keyboardEndCoordinatesScreenY
      const totalExtraHeight =
        this._extraScrollHeight() + this.props.extraHeight
      if (Platform.OS === 'ios') {
        if (
          textInputBottomPosition >
          keyboardPosition - totalExtraHeight
        ) {
          this._scrollToFocusedInputWithNodeHandle(
            currentlyFocusedField,
            null,
            keyboardOpeningTime
          )
        }
      } else {
        // On android, the system would scroll the text input just
        // above the keyboard so we just need to scroll the extra
        // height part
        if (textInputBottomPosition > keyboardPosition) {
          // Since the system already scrolled the whole view up
          // we should reduce that amount
          let adjustedKeyboardSpace =
            keyboardSpace -
            (textInputBottomPosition - keyboardPosition)
          this.setState({ adjustedKeyboardSpace })
          this.scrollForExtraHeightOnAndroid(totalExtraHeight)
        } else if (
          textInputBottomPosition >
          keyboardPosition - totalExtraHeight
        ) {
          this.scrollForExtraHeightOnAndroid(
            totalExtraHeight -
              (keyboardPosition - textInputBottomPosition)
          )
        }
      }
    }

    _resetKeyboardSpace = () => {
      this.keyboardWillHideTime = Date.now();
      const keyboardSpace: number = this.props.viewIsInsideTabBar
        ? _KAM_DEFAULT_TAB_BAR_HEIGHT
        : 0
      this.setState({ keyboardSpace, keyboardEndCoordinatesScreenY: undefined })
      // Reset scroll position after keyboard dismissal
      if (this.props.enableResetScrollToCoords === false) {
        this.defaultResetScrollToCoords = null
        return
      } else if (this.props.resetScrollToCoords) {
        this.scrollToPosition(this.props.resetScrollToCoords.x, this.props.resetScrollToCoords.y, true)
      } else {
        if (this.defaultResetScrollToCoords) {
          this.scrollToPosition(
            this.defaultResetScrollToCoords.x,
            this.defaultResetScrollToCoords.y,
            true
          )
          this.defaultResetScrollToCoords = null
        } else {
          this.scrollToPosition(0, 0, true)
        }
      }
    }

    _scrollToFocusedInputWithNodeHandle = (
      nodeID: number,
      extraHeight?: number,
      keyboardOpeningTime?: number
    ) => {
      if (extraHeight === undefined) {
        extraHeight = this.props.extraHeight
      }
      const reactNode = ReactNative.findNodeHandle(nodeID)
      this.scrollToFocusedInput(
        reactNode,
        extraHeight + this._extraScrollHeight(),
        keyboardOpeningTime !== undefined
          ? keyboardOpeningTime
          : this.props.keyboardOpeningTime || 0
      )
    }

    _handleOnScroll = (
      e: SyntheticEvent<*> & { nativeEvent: { contentOffset: number } }
    ) => {
      this.position = e.nativeEvent.contentOffset
    }

    _handleOnLayout = () => {
      this.parentLayout = null;
    }

    _handleRef = (ref: React.Component<*>) => {
      this._rnkasv_keyboardView = ref ? hocOptions.extractNativeRef(ref) : ref
      if (this.props.innerRef) {
        this.props.innerRef(this._rnkasv_keyboardView)
      }
    }

    update = () => {
      const currentlyFocusedField = TextInput.State.currentlyFocusedField()
      const responder = this.getScrollResponder()

      if (!currentlyFocusedField || !responder) {
        return
      }

      this._scrollToFocusedInputWithNodeHandle(currentlyFocusedField)
    }

    render() {
      const { enableOnAndroid, contentContainerStyle, onScroll, onLayout } = this.props
      let newContentContainerStyle
      if (Platform.OS === 'android' && enableOnAndroid) {
        newContentContainerStyle = [].concat(contentContainerStyle).concat({
          paddingBottom:
            ((contentContainerStyle || {}).paddingBottom || 0) +
            this.state.keyboardSpace
        })
      }
      const refProps = { [hocOptions.refPropName]: this._handleRef }
      return (
        <ScrollableComponent
          {...refProps}
          keyboardDismissMode='interactive'
          contentInset={{ bottom: this.state.keyboardSpace }}
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={true}
          scrollEventThrottle={1}
          {...this.props}
          contentContainerStyle={
            newContentContainerStyle || contentContainerStyle
          }
          keyboardSpace={this.state.keyboardSpace}
          getScrollResponder={this.getScrollResponder}
          scrollToPosition={this.scrollToPosition}
          refreshScrollForField={this.refreshScrollForField}
          scrollToEnd={this.scrollToEnd}
          scrollForExtraHeightOnAndroid={this.scrollForExtraHeightOnAndroid}
          scrollToFocusedInput={this.scrollToFocusedInput}
          scrollIntoView={this.scrollIntoView}
          resetKeyboardSpace={this._resetKeyboardSpace}
          handleOnScroll={this._handleOnScroll}
          handleOnLayout={this._handleOnLayout}
          update={this.update}
          onScroll={Animated.forkEvent(onScroll, this._handleOnScroll)}
          onLayout={Animated.forkEvent(onLayout, this._handleOnLayout)}
        />
      )
    }
  }
}

// Allow to pass options, without breaking change, and curried for composition
// listenToKeyboardEvents(ScrollView);
// listenToKeyboardEvents(options)(Comp);
const listenToKeyboardEvents = (configOrComp: any) => {
  if (typeof configOrComp === 'object') {
    return (Comp: Function) => KeyboardAwareHOC(Comp, configOrComp)
  } else {
    return KeyboardAwareHOC(configOrComp)
  }
}

export default listenToKeyboardEvents
