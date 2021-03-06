/* eslint linebreak-style: ["error", "windows"] */
// TODO: Option to delete photos after upload
import React, { Component } from 'react';
import sleep from 'sleep-promise';
import {
  Text,
  View,
  CameraRoll,
  Slider,
  TouchableOpacity,
  Vibration,
  TextInput,
  ScrollView,
  AppState,
} from 'react-native';
import { NativeStorage } from 'redux-persist-react-native-fs';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Modal from 'react-native-modal';
import base64 from 'base-64';
import RNFetchBlob from 'react-native-fetch-blob';
import moment from 'moment';
import _ from 'lodash';
import { RNS3 } from 'react-native-aws3';
import styles from './styles';
import AwsOptions from './secrets';

const VIBRATION_DURATION = 10000;
const VIBRATION_PATTERN = [500, 1000, 500];


export default class App extends Component {

  state = {
    selectedPhotos: [],
    pendingPhotos: [],
    selectedVideos: [],
    pendingVideos: [],
    isUploading: false,
    fileLimit: 5,
    filesUploaded: 0,
    filesSkipped: [],
    showProgress: false,
    uploadCompleted: false,
    isModalVisible: false,
    customAwsOptions: {},
    totalPhotosUploadSize: 0,
    totalVideosUploadSize: 0,
    totalPhotosInDevice: 0,
    totalVideosInDevice: 0,
    appState: AppState.currentState,
  }

  async componentDidMount() {
    AppState.addEventListener('change', this._handleAppStateChange);
    await this.fetchTotalFilesCount();
  }

  componentWillUnmount() {
    AppState.removeEventListener('change', this._handleAppStateChange);
  }

  getPhotos = (all = false) => {
    return new Promise((resolve, reject) => {
      CameraRoll.getPhotos({
        first: all ? 99999 : this.state.fileLimit,
        // FIXME: Currently, RN has a bug on android and assetType 'All'
        // does not return Videos. This only happend on Android
        // https://github.com/facebook/react-native/pull/16429
        assetType: 'All',
      })
      .then((r) => {
        resolve(r.edges);
      })
      .catch(e => reject(e));
    });
  }

  getVideos = (all = false) => {
    return new Promise((resolve, reject) => {
      CameraRoll.getPhotos({
        first: all ? 99999 : this.state.fileLimit,
        assetType: 'Videos',
      })
      .then((r) => {
        resolve(r.edges);
      })
      .catch(e => reject(e));
    });
  }

  fileSkipped = async (file) => {
    console.warn('file skipped: ', file);
    const filesSkippedSoFar = this.state.filesSkipped;
    const filesSkipped = filesSkippedSoFar.concat(file);
    this.setState({
      filesSkipped,
    });
  }

  toggleModal = () => {
    this.setState({ modalVisible: !this.state.modalVisible });
  }

  // TODO: use https://github.com/devfd/react-native-geocoder
  // to tag the location
  getLocation = () => {
    return 'mordor';
    // return new Promise((resolve, reject) => {
    //   geocoder.reverseGeocode(33.7489, -84.3789, (err, data) => {
    //   // do something with data
    //     console.log('resolved loc: ', data);
    //     if (err) reject(err);
    //     resolve(data);
    //   });
    // });
  };

  getFileName = (file) => {
    const { uri } = file.node.image;
    const { type, coordinates } = file.node;
    const name = `${uri.substr(uri.lastIndexOf('/') + 1, uri.length)}`;
    const fileName = coordinates ?
      `${name}@${this.getLocation()}` :
      name;
    const suffix = type.split('/')[1];
    return `${fileName}.${suffix}`;
  }

  // FIXME: Maybe derive type from file extension?
  upload = async (file, type = 'photo') => {
    const { pendingPhotos, pendingVideos } = this.state;
    return new Promise(async (resolve) => {
      const imgURI = file.node.image.uri;
      const fileToUpload = {
        uri: imgURI,
        name: this.getFileName(file),
        type: file.node.type,
      };
      try {
        const folderPrefix = file.folder;
        const prefixedAwsOptions = {
          ...AwsOptions,
          // ...this.state.customAwsOptions, // Uncomment to actually override
          keyPrefix: AwsOptions.keyPrefix + folderPrefix,
        };
        const response = await RNS3.put(fileToUpload, prefixedAwsOptions);
        if (response.status !== 201) {
          await this.fileSkipped({ file, error: response });
          resolve();
        }
        const filesUploadedSoFar = this.state.filesUploaded;
        const filesUploaded = ++filesUploadedSoFar;
        this.setState({
          filesUploaded,
          pendingPhotos: type === 'photo' ? _.remove(pendingPhotos, f => f.node.image.uri === imgURI) : pendingPhotos,
          pendingVideos: type === 'video' ? _.remove(pendingVideos, f => f.node.image.uri === imgURI) : pendingVideos,
        });
        resolve();
      } catch (e) {
        this.fileSkipped({ file, error: e });
      } finally {
        resolve();
      }
    });
  }

  getPrefixFolderByDate = (date) => {
    const year = moment.unix(date).format('YYYY');
    const month = moment.unix(date).format('MMMM');
    return `${year}/${month}/`;
  }

  organizeFiles = (files) => {
    const result = files.map((file) => {
      const date = file.node.timestamp;
      const prefix = this.getPrefixFolderByDate(date);
      return {
        ...file,
        folder: prefix,
      };
    });
    return result;
  }

  onUploadCompleted = async () => {
    Vibration.vibrate(VIBRATION_PATTERN);
    if (this.state.filesSkipped.length) {
      console.log('Files skipped with errors: ', this.state.filesSkipped);
    }
    this.setState({
      isUploading: false,
      selectedPhotos: [],
      uploadCompleted: true,
    });
    console.log('All done! :)');
  }

  uploadPhotos = async () => {
    const photosToUpload = this.state.pendingPhotos;
    const organizedPhotos = this.organizeFiles(photosToUpload);
    await Promise.all(organizedPhotos.map(p => this.upload(p, 'photo')));
  }

  uploadVideos = async () => {
    const videosToUpload = this.state.pendingVideos;
    const organizedVideos = this.organizeFiles(videosToUpload);
    await Promise.all(organizedVideos.map(p => this.upload(p, 'video')));
    this.onUploadCompleted();
  }

  getTotalSizeInMB = async (files) => {
    let size = 0;
    await Promise.all(files.map(async (f) => {
      const encodedData = await RNFetchBlob.fs.readFile(f.node.image.uri, 'base64');
      const decodedData = base64.decode(encodedData);
      size += decodedData.length;
    }));
    return Number((size / 1000 / 1000).toFixed(2));
  }

  _handleAppStateChange = async (nextAppState) => {
    if (this.state.appState.match(/inactive|background/) && nextAppState === 'active') {
      console.log('-----> App has come to foreground!');
      const retrievedState = await NativeStorage.getItem('state');
      const { pendingPhotos, pendingVideos } = retrievedState;
      console.log('resuming uploads with pending photos: ', pendingPhotos.length);
      // Should resume upload
      this.setState(retrievedState);
      await this.uploadPhotos();
      await this.uploadVideos();
    } else {
      // App is in background / inactive
      console.log('<----- App has gone to background!');
      await NativeStorage.setItem('state', this.state);
    }
    this.setState({ appState: nextAppState });
  }

  handleCloseModal = () => {
    console.log('close modal');
    this.setState({ isModalVisible: false });
  }

  async fetchTotalFilesCount() {
    this.setState({
      totalPhotosInDevice: (await this.getPhotos(true)).length,
      totalVideosInDevice: (await this.getVideos(true)).length,
    });
  }

  _showModal = () => {
    console.log('open modal');
    this.setState({ isModalVisible: true });
  }

  handleSelectPhotosClick = async () => {
    const fetchedPhotos = await this.getPhotos();
    // try {
    //   const totalSize = await this.getTotalSizeInMB(fetchedPhotos);
    //   this.setState({ totalPhotosUploadSize: totalSize });
    // } catch (e) {
    //   console.log('something went wroνg ', e);
    // }

    this.setState({
      selectedPhotos: fetchedPhotos,
      pendingPhotos: fetchedPhotos,
      showProgress: true,
    });
  }

  handleSelectVideosClick = async () => {
    const fetchedVideos = await this.getVideos();
    // try {
    //   // TODO: for large videos, stream the file size instead
    //   const totalSize = await this.getTotalSizeInMB(fetchedVideos);
    //   this.setState({ totalVideosUploadSize: totalSize });
    // } catch (e) {
    //   console.log('something went wroνg ', e);
    // }
    this.setState({
      selectedVideos: fetchedVideos,
      pendingVideos: fetchedVideos,
      showProgress: true,
    });
  }

  handleUploadClick = async () => {
    this.setState({ isUploading: true, filesUploaded: 0, filesSkipped: [] });
    await sleep(10);
    await this.uploadPhotos();
    await this.uploadVideos();
  }

  renderUploadProgress() {
    const {
      filesUploaded,
      selectedPhotos,
      selectedVideos,
      uploadCompleted,
      filesSkipped } = this.state;
    let progressText = '';
    if (!uploadCompleted) {
      progressText = filesUploaded ?
      `Files uploaded: ${filesUploaded} / ${selectedPhotos.length + selectedVideos.length}` :
      'Files prepared for upload';
    } else {
      progressText = `${filesUploaded} files uploaded. ${filesSkipped.length} files skipped.`;
    }

    return this.state.showProgress &&
      <Text>
        {progressText}
      </Text>;
  }

  renderSkippedFiles() {
    const { filesSkipped } = this.state;
    return !!filesSkipped.length &&
      (
        <ScrollView>
          filesSkipped.map(info =>
          <Text>
              info.title : info.error
          </Text>
          )
        </ScrollView>
      );
  }

  photosNumberChange = async (value) => {
    this.setState({
      fileLimit: value,
    });
  }

  renderSettingsModal() {
    const { customAwsOptions } = this.state;

    return (
      <View style={{ display: 'flex', marginRight: 'auto', margin: 20 }}>
        <TouchableOpacity onPress={this._showModal}>
          <Icon
            name="menu"
            size={25}
            color="black"
            style={{ marginTop: 40 }}
          />
        </TouchableOpacity>
        <Modal style={styles.settingsModal} isVisible={this.state.isModalVisible}>
          <View >
            <TouchableOpacity
              onPress={this.handleCloseModal}
            >

              <Icon
                name="settings"
                size={25}
                color="white"
                style={{ alignSelf: 'center' }}
              />
              <Text style={styles.textMW}> AWS S3 Settings </Text>
              <Text style={styles.textS}> S3 Bucket name </Text>
              <TextInput
                style={styles.inputTextWhite}
                onChangeText={async (bucket) => {
                  this.setState({
                    customAwsOptions: {
                      ...customAwsOptions,
                      bucket,
                    },
                  });
                }

              }
                value={this.state.bucket}
              />

              <Text style={styles.textS}> Region </Text>
              <TextInput
                style={styles.inputTextWhite}
                onChangeText={async (region) => {
                  this.setState({
                    customAwsOptions: {
                      ...customAwsOptions,
                      region,
                    },
                  });
                }
              }
                value={this.state.region}
              />
              <Text style={styles.textS}> Access Key </Text>
              <TextInput
                style={styles.inputTextWhite}
                onChangeText={async (accessKey) => {
                  this.setState({
                    customAwsOptions: {
                      ...customAwsOptions,
                      accessKey,
                    },
                  });
                }
              }
                value={this.state.accessKey}
              />
              <Text style={styles.textS}> Secret Key </Text>
              <TextInput
                style={styles.inputTextWhite}
                secureTextEntry
                onChangeText={async (secretKey) => {
                  this.setState({
                    customAwsOptions: {
                      ...customAwsOptions,
                      secretKey,
                    },
                  });
                }
              }
                value={this.state.secretKey}
              />

              <View style={styles.selectButton}>
                <Text style={styles.textS}>Save & Close</Text>
              </View>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  renderAwsWarning = () => {
    return !(AwsOptions.bucket !== 'your-bucket-name' && this.state.customAwsOptions) &&
      <View>
        <Icon
          name="warning"
          size={15}
          color="black"
          style={{ alignSelf: 'center' }}
        />
        <Text style={styles.warning}>
          You need to provide AWS settings, in the options menu
        </Text>
      </View>;
  }

  render() {
    const {
      selectedPhotos,
      selectedVideos,
      isUploading,
      fileLimit,
      totalPhotosUploadSize,
      totalVideosUploadSize,
      totalPhotosInDevice,
      totalVideosInDevice,
    } = this.state;
    const selectPhotosText = selectedPhotos.length ?
      `${selectedPhotos.length} photos selected` :
      'Select photos';

    const selectVideosText = selectedVideos.length ?
      `${selectedVideos.length} videos selected` :
      'Select videos';

    const uploadText = isUploading ?
      'Uploading to ☁️' :
      'Upload to ☁️';

    const uploadingBtnStyle = isUploading ?
      styles.uploadButtonDisabled :
      styles.uploadButton;


    return (
      <View style={styles.container}>
        {this.renderSettingsModal()}
        <Text style={styles.welcomeLarge}>
            📦
        </Text>

        <Text style={styles.welcome}>
            Welcome to Briefcase!
        </Text>
        <Text style={{ margin: 20 }}>
        Slide to select X latest files to upload : {fileLimit}
        </Text>
        <Text style={{ margin: 3, fontSize: 11 }}>
        (out of <Text style={{ fontWeight: 'bold' }}> {totalPhotosInDevice || 0} </Text> photos
        and <Text style={{ fontWeight: 'bold' }}> {totalVideosInDevice || 0} </Text> videos)
        </Text>
        {/* <Text>
            Total size: {totalPhotosUploadSize + totalVideosUploadSize} MB
          </Text> */}
        {this.renderAwsWarning()}
        <Slider
          maximumValue={totalPhotosInDevice + totalVideosInDevice}
          minimumValue={1}
          step={5}
          onValueChange={this.photosNumberChange}
          onSlidingComplete={this.photosNumberChange}
          style={{ width: 300, height: 50, marginBottom: 60 }}
        />
        {this.renderUploadProgress()}
        <TouchableOpacity
          onPress={this.handleSelectPhotosClick}
          underlayColor="white"
        >
          <View style={styles.selectButton}>
            <Text style={styles.buttonText}>{selectPhotosText}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={this.handleSelectVideosClick}
          underlayColor="white"
        >
          <View style={styles.selectButton}>
            <Text style={styles.buttonText}>{selectVideosText}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          underlayColor="white"
          disabled={!!isUploading}
          onPress={this.handleUploadClick}
        >
          <View style={uploadingBtnStyle}>
            <Text style={styles.buttonText}>{uploadText}</Text>
          </View>
        </TouchableOpacity>

      </View>
    );
  }
}
