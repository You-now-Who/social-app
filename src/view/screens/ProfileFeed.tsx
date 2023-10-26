import React, {useMemo, useCallback} from 'react'
import {StyleSheet, View, ActivityIndicator} from 'react-native'
import {NativeStackScreenProps} from '@react-navigation/native-stack'
import {useNavigation} from '@react-navigation/native'
import {usePalette} from 'lib/hooks/usePalette'
import {HeartIcon, HeartIconSolid} from 'lib/icons'
import {FontAwesomeIcon} from '@fortawesome/react-native-fontawesome'
import {CommonNavigatorParams} from 'lib/routes/types'
import {makeRecordUri} from 'lib/strings/url-helpers'
import {colors, s} from 'lib/styles'
import {observer} from 'mobx-react-lite'
import {useStores} from 'state/index'
import {FeedSourceModel} from 'state/models/content/feed-source'
import {PostsFeedModel} from 'state/models/feeds/posts'
import {withAuthRequired} from 'view/com/auth/withAuthRequired'
import {TabsContainer, Tab, TabsContainerHandle} from 'view/com/tabs/Tabs'
import {ProfileSubpageHeader} from 'view/com/profile/ProfileSubpageHeader'
import {TextLink} from 'view/com/util/Link'
import {Button} from 'view/com/util/forms/Button'
import {Text} from 'view/com/util/text/Text'
import {RichText} from 'view/com/util/text/RichText'
import {LoadLatestBtn} from 'view/com/util/load-latest/LoadLatestBtn'
import {FAB} from 'view/com/util/fab/FAB'
import {PostFeedLoadingPlaceholder} from 'view/com/util/LoadingPlaceholder'
import {EmptyState} from 'view/com/util/EmptyState'
import {FeedSlice} from 'view/com/posts/FeedSlice'
import * as Toast from 'view/com/util/Toast'
import {useSetTitle} from 'lib/hooks/useSetTitle'
import {useCustomFeed} from 'lib/hooks/useCustomFeed'
import {useOnMainScroll} from 'lib/hooks/useOnMainScroll'
import {shareUrl} from 'lib/sharing'
import {toShareUrl} from 'lib/strings/url-helpers'
import {Haptics} from 'lib/haptics'
import {useAnalytics} from 'lib/analytics/analytics'
import {NativeDropdown, DropdownItem} from 'view/com/util/forms/NativeDropdown'
import {resolveName} from 'lib/api'
import {makeCustomFeedLink} from 'lib/routes/links'
import {pluralize} from 'lib/strings/helpers'
import {CenteredView} from 'view/com/util/Views'
import {NavigationProp} from 'lib/routes/types'
import {sanitizeHandle} from 'lib/strings/handles'
import {makeProfileLink} from 'lib/routes/links'
import {ComposeIcon2} from 'lib/icons'

type Props = NativeStackScreenProps<CommonNavigatorParams, 'ProfileFeed'>
export const ProfileFeedScreen = withAuthRequired(
  observer(function ProfileFeedScreenImpl(props: Props) {
    const pal = usePalette('default')
    const store = useStores()
    const navigation = useNavigation<NavigationProp>()

    const {name: handleOrDid} = props.route.params

    const [feedOwnerDid, setFeedOwnerDid] = React.useState<string | undefined>()
    const [error, setError] = React.useState<string | undefined>()

    const onPressBack = React.useCallback(() => {
      if (navigation.canGoBack()) {
        navigation.goBack()
      } else {
        navigation.navigate('Home')
      }
    }, [navigation])

    React.useEffect(() => {
      /*
       * We must resolve the DID of the feed owner before we can fetch the feed.
       */
      async function fetchDid() {
        try {
          const did = await resolveName(store, handleOrDid)
          setFeedOwnerDid(did)
        } catch (e) {
          setError(
            `We're sorry, but we were unable to resolve this feed. If this persists, please contact the feed creator, @${handleOrDid}.`,
          )
        }
      }

      fetchDid()
    }, [store, handleOrDid, setFeedOwnerDid])

    if (error) {
      return (
        <CenteredView>
          <View style={[pal.view, pal.border, styles.notFoundContainer]}>
            <Text type="title-lg" style={[pal.text, s.mb10]}>
              Could not load feed
            </Text>
            <Text type="md" style={[pal.text, s.mb20]}>
              {error}
            </Text>

            <View style={{flexDirection: 'row'}}>
              <Button
                type="default"
                accessibilityLabel="Go Back"
                accessibilityHint="Return to previous page"
                onPress={onPressBack}
                style={{flexShrink: 1}}>
                <Text type="button" style={pal.text}>
                  Go Back
                </Text>
              </Button>
            </View>
          </View>
        </CenteredView>
      )
    }

    return feedOwnerDid ? (
      <ProfileFeedScreenInner {...props} feedOwnerDid={feedOwnerDid} />
    ) : (
      <CenteredView>
        <View style={s.p20}>
          <ActivityIndicator size="large" />
        </View>
      </CenteredView>
    )
  }),
)

export const ProfileFeedScreenInner = observer(
  function ProfileFeedScreenInnerImpl({
    route,
    feedOwnerDid,
  }: Props & {feedOwnerDid: string}) {
    const pal = usePalette('default')
    const store = useStores()
    const {track} = useAnalytics()
    const {rkey, name: handleOrDid} = route.params
    const uri = useMemo(
      () => makeRecordUri(feedOwnerDid, 'app.bsky.feed.generator', rkey),
      [rkey, feedOwnerDid],
    )
    const feedInfo = useCustomFeed(uri)
    const feed: PostsFeedModel = useMemo(() => {
      const model = new PostsFeedModel(store, 'custom', {
        feed: uri,
      })
      model.setup()
      return model
    }, [store, uri])
    const [onMainScroll, isScrolledDown, resetMainScroll] =
      useOnMainScroll(store)
    const tabsContainerRef = React.useRef<TabsContainerHandle>(null)
    const isPinned = store.preferences.isPinnedFeed(uri)
    useSetTitle(feedInfo?.displayName)

    // events
    // =

    const onScrollToTop = useCallback(() => {
      tabsContainerRef.current?.scrollToTop()
      resetMainScroll()
    }, [tabsContainerRef, resetMainScroll])

    const onToggleSaved = React.useCallback(async () => {
      try {
        Haptics.default()
        if (feedInfo?.isSaved) {
          await feedInfo?.unsave()
        } else {
          await feedInfo?.save()
        }
      } catch (err) {
        Toast.show(
          'There was an an issue updating your feeds, please check your internet connection and try again.',
        )
        store.log.error('Failed up update feeds', {err})
      }
    }, [store, feedInfo])

    const onToggleLiked = React.useCallback(async () => {
      Haptics.default()
      try {
        if (feedInfo?.isLiked) {
          await feedInfo?.unlike()
        } else {
          await feedInfo?.like()
        }
      } catch (err) {
        Toast.show(
          'There was an an issue contacting the server, please check your internet connection and try again.',
        )
        store.log.error('Failed up toggle like', {err})
      }
    }, [store, feedInfo])

    const onTogglePinned = React.useCallback(async () => {
      Haptics.default()
      if (feedInfo) {
        feedInfo.togglePin().catch(e => {
          Toast.show('There was an issue contacting the server')
          store.log.error('Failed to toggle pinned feed', {e})
        })
      }
    }, [store, feedInfo])

    const onPressShare = React.useCallback(() => {
      const url = toShareUrl(`/profile/${handleOrDid}/feed/${rkey}`)
      shareUrl(url)
      track('CustomFeed:Share')
    }, [handleOrDid, rkey, track])

    const onPressReport = React.useCallback(() => {
      if (!feedInfo) return
      store.shell.openModal({
        name: 'report',
        uri: feedInfo.uri,
        cid: feedInfo.cid,
      })
    }, [store, feedInfo])

    const onPostsRefresh = useCallback(() => feed.refresh(), [feed])
    const onPostsEndReached = useCallback(() => feed.loadMore(), [feed])
    const onPostsRetryLoadMore = useCallback(() => feed.retryLoadMore(), [feed])

    // render
    // =

    const dropdownItems: DropdownItem[] = React.useMemo(() => {
      return [
        {
          testID: 'feedHeaderDropdownToggleSavedBtn',
          label: feedInfo?.isSaved ? 'Remove from my feeds' : 'Add to my feeds',
          onPress: onToggleSaved,
          icon: feedInfo?.isSaved
            ? {
                ios: {
                  name: 'trash',
                },
                android: 'ic_delete',
                web: ['far', 'trash-can'],
              }
            : {
                ios: {
                  name: 'plus',
                },
                android: '',
                web: 'plus',
              },
        },
        {
          testID: 'feedHeaderDropdownReportBtn',
          label: 'Report feed',
          onPress: onPressReport,
          icon: {
            ios: {
              name: 'exclamationmark.triangle',
            },
            android: 'ic_menu_report_image',
            web: 'circle-exclamation',
          },
        },
        {
          testID: 'feedHeaderDropdownShareBtn',
          label: 'Share link',
          onPress: onPressShare,
          icon: {
            ios: {
              name: 'square.and.arrow.up',
            },
            android: 'ic_menu_share',
            web: 'share',
          },
        },
      ] as DropdownItem[]
    }, [feedInfo, onToggleSaved, onPressReport, onPressShare])

    const renderHeader = useCallback(() => {
      return (
        <ProfileSubpageHeader
          href={makeCustomFeedLink(feedOwnerDid, rkey)}
          title={feedInfo?.displayName}
          avatar={feedInfo?.avatar}
          isOwner={feedInfo?.isOwner}
          creator={
            feedInfo
              ? {did: feedInfo.creatorDid, handle: feedInfo.creatorHandle}
              : undefined
          }
          avatarType="algo">
          {feedInfo && (
            <>
              <Button
                type="default"
                label={feedInfo?.isSaved ? 'Unsave' : 'Save'}
                onPress={onToggleSaved}
                style={styles.btn}
              />
              <Button
                type={isPinned ? 'default' : 'inverted'}
                label={isPinned ? 'Unpin' : 'Pin to home'}
                onPress={onTogglePinned}
                style={styles.btn}
              />
            </>
          )}
          <NativeDropdown
            testID="headerDropdownBtn"
            items={dropdownItems}
            accessibilityLabel="More options"
            accessibilityHint="">
            <View style={[pal.viewLight, styles.btn]}>
              <FontAwesomeIcon
                icon="ellipsis"
                size={20}
                color={pal.colors.text}
              />
            </View>
          </NativeDropdown>
        </ProfileSubpageHeader>
      )
    }, [
      pal,
      feedOwnerDid,
      rkey,
      feedInfo,
      isPinned,
      onTogglePinned,
      onToggleSaved,
      dropdownItems,
    ])

    const renderPostsPlaceholder = useCallback(() => {
      return <PostFeedLoadingPlaceholder />
    }, [])

    const renderPostsEmpty = useCallback(() => {
      return <EmptyState icon="feed" message="This feed is empty!" />
    }, [])

    const renderPostsItem = useCallback(
      (item: any) => <FeedSlice slice={item} />,
      [],
    )

    const renderAboutHeader = useCallback(() => {
      return (
        <AboutSection
          feedOwnerDid={feedOwnerDid}
          feedRkey={rkey}
          feedInfo={feedInfo}
          onToggleLiked={onToggleLiked}
        />
      )
    }, [feedOwnerDid, rkey, feedInfo, onToggleLiked])

    return (
      <View style={s.hContentRegion}>
        <TabsContainer
          ref={tabsContainerRef}
          renderHeader={renderHeader}
          onSelectTab={onScrollToTop}
          onScroll={onMainScroll}>
          <Tab
            name="Posts"
            items={feed.slices}
            isLoading={feed.isLoading}
            hasLoaded={feed.hasLoaded}
            isRefreshing={feed.isRefreshing}
            isEmpty={feed.isEmpty}
            hasMore={feed.hasMore}
            error={feed.error}
            loadMoreError={feed.loadMoreError}
            renderItem={renderPostsItem}
            renderPlaceholder={renderPostsPlaceholder}
            renderEmpty={renderPostsEmpty}
            onRefresh={onPostsRefresh}
            onEndReached={onPostsEndReached}
            onRetryLoadMore={onPostsRetryLoadMore}
          />
          <Tab name="About" renderHeader={renderAboutHeader} />
        </TabsContainer>
        {isScrolledDown ? (
          <LoadLatestBtn
            onPress={onScrollToTop}
            label="Scroll to top"
            showIndicator={false}
          />
        ) : null}
        <FAB
          testID="composeFAB"
          onPress={() => store.shell.openComposer({})}
          icon={
            <ComposeIcon2
              strokeWidth={1.5}
              size={29}
              style={{color: 'white'}}
            />
          }
          accessibilityRole="button"
          accessibilityLabel="New post"
          accessibilityHint=""
        />
      </View>
    )

    // return (
    //   <View style={s.hContentRegion}>
    //     <Header
    //       feedOwnerDid={feedOwnerDid}
    //       feedRkey={rkey}
    //       feedInfo={feedInfo}
    //       dropdownItems={dropdownItems}
    //       headerBtns={headerBtns}
    //       minimalMode={false}
    //     />
    //     <Pager renderTabBar={renderTabBar} tabBarPosition="top">
    //       <ProfileScreenFeedPage key="1" feed={algoFeed} />
    //       <AboutPage
    //         key="2"
    //         feedOwnerDid={feedOwnerDid}
    //         feedRkey={rkey}
    //         feedInfo={feedInfo}
    //         onToggleLiked={onToggleLiked}
    //       />
    //     </Pager>
    //   </View>
    // )
  },
)

const AboutSection = observer(function AboutPageImpl({
  feedOwnerDid,
  feedRkey,
  feedInfo,
  onToggleLiked,
}: {
  feedOwnerDid: string
  feedRkey: string
  feedInfo: FeedSourceModel | undefined
  onToggleLiked: () => void
}) {
  const pal = usePalette('default')

  if (!feedInfo) {
    return <View />
  }
  return (
    <View
      style={[
        {
          borderTopWidth: 1,
          paddingVertical: 20,
          paddingHorizontal: 20,
          gap: 12,
        },
        pal.border,
      ]}>
      {feedInfo.descriptionRT ? (
        <RichText
          testID="listDescription"
          type="lg"
          style={pal.text}
          richText={feedInfo.descriptionRT}
        />
      ) : (
        <Text type="lg" style={[{fontStyle: 'italic'}, pal.textLight]}>
          No description
        </Text>
      )}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
        <Button
          type="default"
          testID="toggleLikeBtn"
          accessibilityLabel="Like this feed"
          accessibilityHint=""
          onPress={onToggleLiked}
          style={{paddingHorizontal: 10}}>
          {feedInfo?.isLiked ? (
            <HeartIconSolid size={19} style={styles.liked} />
          ) : (
            <HeartIcon strokeWidth={3} size={19} style={pal.textLight} />
          )}
        </Button>
        {typeof feedInfo.likeCount === 'number' && (
          <TextLink
            href={makeCustomFeedLink(feedOwnerDid, feedRkey, 'liked-by')}
            text={`Liked by ${feedInfo.likeCount} ${pluralize(
              feedInfo.likeCount,
              'user',
            )}`}
            style={[pal.textLight, s.semiBold]}
          />
        )}
      </View>
      <Text type="md" style={[pal.textLight]} numberOfLines={1}>
        Created by{' '}
        {feedInfo.isOwner ? (
          'you'
        ) : (
          <TextLink
            text={sanitizeHandle(feedInfo.creatorHandle, '@')}
            href={makeProfileLink({
              did: feedInfo.creatorDid,
              handle: feedInfo.creatorHandle,
            })}
            style={pal.textLight}
          />
        )}
      </Text>
    </View>
  )
})

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 50,
    marginLeft: 6,
  },
  liked: {
    color: colors.red3,
  },
  notFoundContainer: {
    margin: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 6,
  },
})
