import PropTypes from 'prop-types';
import React from 'react';
import styled from '@emotion/styled';
import uniqWith from 'lodash/uniqWith';
import isEqual from 'lodash/isEqual';
import {browserHistory} from 'react-router';

import {openModal} from 'app/actionCreators/modal';
import Button from 'app/components/button';
import {
  addErrorMessage,
  addLoadingMessage,
  clearIndicators,
} from 'app/actionCreators/indicator';
import {Client} from 'app/api';
import EventErrorItem from 'app/components/events/errorItem';
import {Event} from 'app/types';
import {IconWarning} from 'app/icons';
import {t, tn} from 'app/locale';
import space from 'app/styles/space';
import withApi from 'app/utils/withApi';

import {BannerContainer, BannerSummary} from './styles';

const MAX_ERRORS = 100;

type Props = {
  api: Client;
  event: Event;
  orgId: string;
  projectId: string;
  issueId: string;
};

type State = {
  isOpen: boolean;
};

class EventErrors extends React.Component<Props, State> {
  static propTypes: any = {
    api: PropTypes.object.isRequired,
    event: PropTypes.object.isRequired,
    orgId: PropTypes.string.isRequired,
    projectId: PropTypes.string.isRequired,
    issueId: PropTypes.string.isRequired,
  };

  state: State = {
    isOpen: false,
  };

  shouldComponentUpdate(nextProps: Props, nextState: State) {
    if (this.state.isOpen !== nextState.isOpen) {
      return true;
    }
    return this.props.event.id !== nextProps.event.id;
  }

  toggle = () => {
    this.setState({isOpen: !this.state.isOpen});
  };

  uniqueErrors = errors => uniqWith(errors, isEqual);

  onReprocessEvent = async () => {
    const {orgId, projectId, event} = this.props;
    const endpoint = `/projects/${orgId}/${projectId}/events/${event.id}/reprocessing/`;

    addLoadingMessage(t('Reprocessing event\u2026'));

    try {
      await this.props.api.requestPromise(endpoint, {
        method: 'PUT',
      });
    } catch (e) {
      clearIndicators();
      addErrorMessage(
        t('Failed to start reprocessing. The event is likely too far in the past.')
      );
      return;
    }

    clearIndicators();
    browserHistory.push(
      `/organizations/${orgId}/issues/?query=tags[original_event_id]:${event.id}`
    );
  };

  onReprocessGroup = async () => {
    const {orgId, issueId} = this.props;
    const endpoint = `/organizations/${orgId}/issues/${issueId}/reprocessing/`;

    addLoadingMessage(t('Reprocessing issue\u2026'));

    try {
      await this.props.api.requestPromise(endpoint, {
        method: 'PUT',
      });
    } catch (e) {
      clearIndicators();
      addErrorMessage(
        t('Failed to start reprocessing. The event is likely too far in the past.')
      );
      return;
    }

    clearIndicators();
    browserHistory.push(
      `/organizations/${orgId}/issues/?query=tags[original_group_id]:${issueId}`
    );
  };

  onReprocessStart = () => {
    openModal(this.renderReprocessModal);
  };

  renderReprocessModal = ({Body, closeModal}) => (
    <React.Fragment>
      <Body>
        {t(
          'You can choose to re-process events to see if ' +
            'your errors have been resolved. Be warned that Sentry will duplicate ' +
            'events in your project (for now) and bill you for those new events again.'
        )}
      </Body>
      <div className="modal-footer">
        <Button onClick={this.onReprocessGroup}>
          {t('Reprocess all events in issue ($$$)')}
        </Button>
        <Button style={{marginLeft: space(1)}} onClick={this.onReprocessEvent}>
          {t('Reprocess single event ($$)')}
        </Button>
        <Button style={{marginLeft: space(1)}} onClick={closeModal}>
          {t('Cancel ($0)')}
        </Button>
      </div>
    </React.Fragment>
  );

  render() {
    const {event} = this.props;
    // XXX: uniqueErrors is not performant with large datasets
    const errors =
      event.errors.length > MAX_ERRORS ? event.errors : this.uniqueErrors(event.errors);
    const numErrors = errors.length;
    const isOpen = this.state.isOpen;
    return (
      <StyledBanner priority="danger">
        <BannerSummary>
          <StyledIconWarning />
          <span>
            {tn(
              'There was %s error encountered while processing this event',
              'There were %s errors encountered while processing this event',
              numErrors
            )}
          </span>
          <a data-test-id="event-error-toggle" onClick={this.toggle}>
            {isOpen ? t('Hide') : t('Show')}
          </a>
        </BannerSummary>
        <ErrorList
          data-test-id="event-error-details"
          style={{display: isOpen ? 'block' : 'none'}}
        >
          {errors.map((error, errorIdx) => (
            <EventErrorItem key={errorIdx} error={error} />
          ))}

          <Button size="xsmall" onClick={this.onReprocessStart}>
            {t('Try again')}
          </Button>
        </ErrorList>
      </StyledBanner>
    );
  }
}

const StyledBanner = styled(BannerContainer)`
  margin-top: -1px;

  a {
    font-weight: bold;
    color: ${p => p.theme.gray600};
    &:hover {
      color: ${p => p.theme.gray700};
    }
  }
`;

const StyledIconWarning = styled(IconWarning)`
  color: ${p => p.theme.red400};
`;

// TODO(theme) don't use a custom pink
const customPink = '#e7c0bc';

const ErrorList = styled('ul')`
  border-top: 1px solid ${customPink};
  margin: 0 ${space(3)} 0 ${space(4)};
  padding: ${space(1)} 0 ${space(0.5)} ${space(4)};

  li {
    margin-bottom: ${space(0.75)};
    word-break: break-word;
  }

  pre {
    background: #f9eded;
    color: #381618;
    margin: 5px 0 0;
  }
`;

export default withApi<Props>(EventErrors);
